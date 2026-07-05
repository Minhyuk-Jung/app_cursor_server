import type { TreeNode } from "@app/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  createProjectDir,
  createProjectFile,
  deleteProjectFile,
  getProjectFile,
  getProjectTree,
  renameProjectFile,
  saveProjectFile,
  searchProject,
  type Project,
} from "../api/client";
import { SimpleMarkdownView } from "../components/SimpleMarkdownView";
import { ProjectNavBar } from "../components/ProjectNavBar";
import type { MobileSettings } from "../config";
import {
  flattenTree,
  initialExpandedDirs,
  toggleExpandedDir,
  type FlatTreeRow,
} from "../lib/flatten-tree";

type ModalKind = "createFile" | "createDir" | "rename" | null;

function isEditableTextFile(
  encoding: string,
  truncated: boolean,
  language: string,
): boolean {
  return encoding === "utf-8" && !truncated && language !== "binary";
}

function isMarkdownPath(path: string, language: string): boolean {
  return (
    language === "markdown" ||
    path.endsWith(".md") ||
    path.endsWith(".markdown")
  );
}

export function FilesScreen({
  settings,
  project,
  onBack,
  onSessions,
  onGit,
  onTerminal,
  onDiff,
}: {
  settings: MobileSettings;
  project: Project;
  onBack: () => void;
  onSessions: () => void;
  onGit: () => void;
  onTerminal: () => void;
  onDiff: () => void;
}) {
  const [tree, setTree] = useState<TreeNode | null>(null);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [language, setLanguage] = useState("");
  const [truncated, setTruncated] = useState(false);
  const [binary, setBinary] = useState(false);
  const [editable, setEditable] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [mdPreview, setMdPreview] = useState(false);
  const [loadingTree, setLoadingTree] = useState(false);
  const [loadingFile, setLoadingFile] = useState(false);
  const [saving, setSaving] = useState(false);
  const [treeError, setTreeError] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchHits, setSearchHits] = useState<
    Array<{ path: string; line: number; snippet: string }>
  >([]);
  const [modalKind, setModalKind] = useState<ModalKind>(null);
  const [modalInput, setModalInput] = useState("");
  const [modalBusy, setModalBusy] = useState(false);
  const loadSeq = useRef(0);

  const loadTree = useCallback(async () => {
    setLoadingTree(true);
    setTreeError(null);
    try {
      const t = await getProjectTree(settings, project.id);
      setTree(t);
      setExpandedDirs((prev) =>
        prev.size > 0 ? prev : initialExpandedDirs(t.children ?? []),
      );
    } catch (e) {
      setTreeError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingTree(false);
    }
  }, [settings, project.id]);

  useEffect(() => {
    void loadTree();
  }, [loadTree]);

  const treeNodes = useMemo(
    () =>
      tree?.children?.length
        ? tree.children
        : tree?.type === "file"
          ? [tree]
          : [],
    [tree],
  );

  const flatRows = useMemo(
    () => flattenTree(treeNodes, expandedDirs),
    [treeNodes, expandedDirs],
  );

  const handleSelectFile = async (path: string) => {
    const seq = ++loadSeq.current;
    setSelectedPath(path);
    setLoadingFile(true);
    setFileError(null);
    setSaveStatus(null);
    setDraft("");
    setMdPreview(false);
    setSearchHits([]);

    try {
      const file = await getProjectFile(settings, project.id, path);
      if (seq !== loadSeq.current) return;

      if (file.encoding === "binary") {
        setBinary(true);
        setEditable(false);
        setDraft("");
        setTruncated(file.truncated);
        setLanguage(file.language);
      } else {
        setBinary(false);
        setDraft(file.content ?? "");
        setTruncated(file.truncated);
        setLanguage(file.language);
        setEditable(isEditableTextFile(file.encoding, file.truncated, file.language));
        setDirty(false);
      }
    } catch (e) {
      if (seq !== loadSeq.current) return;
      setFileError(e instanceof Error ? e.message : String(e));
    } finally {
      if (seq === loadSeq.current) setLoadingFile(false);
    }
  };

  const handleTreeRowPress = (row: FlatTreeRow) => {
    if (row.type === "dir") {
      setExpandedDirs((prev) => toggleExpandedDir(prev, row.path));
      return;
    }
    void handleSelectFile(row.path);
  };

  const handleSave = async () => {
    if (!selectedPath || !editable || !dirty) return;
    setSaving(true);
    setFileError(null);
    setSaveStatus(null);
    try {
      await saveProjectFile(settings, project.id, selectedPath, draft);
      setDirty(false);
      setSaveStatus("저장됨");
    } catch (e) {
      setFileError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const handleSearch = async () => {
    const q = searchQuery.trim();
    if (!q) return;
    setSearching(true);
    setTreeError(null);
    try {
      const hits = await searchProject(settings, project.id, q);
      setSearchHits(hits);
    } catch (e) {
      setTreeError(e instanceof Error ? e.message : String(e));
    } finally {
      setSearching(false);
    }
  };

  const openModal = (kind: ModalKind, initial = "") => {
    setModalKind(kind);
    setModalInput(initial);
  };

  const handleModalSubmit = async () => {
    const value = modalInput.trim();
    if (!value || !modalKind) return;
    setModalBusy(true);
    setTreeError(null);
    try {
      if (modalKind === "createFile") {
        await createProjectFile(settings, project.id, value);
        await loadTree();
        await handleSelectFile(value);
      } else if (modalKind === "createDir") {
        await createProjectDir(settings, project.id, value);
        await loadTree();
        setExpandedDirs((prev) => toggleExpandedDir(prev, value));
      } else if (modalKind === "rename" && selectedPath) {
        await renameProjectFile(settings, project.id, selectedPath, value);
        await loadTree();
        await handleSelectFile(value);
      }
      setModalKind(null);
      setModalInput("");
    } catch (e) {
      setTreeError(e instanceof Error ? e.message : String(e));
    } finally {
      setModalBusy(false);
    }
  };

  const handleDelete = () => {
    if (!selectedPath) return;
    Alert.alert("삭제", `"${selectedPath}"을(를) 삭제하시겠습니까?`, [
      { text: "취소", style: "cancel" },
      {
        text: "삭제",
        style: "destructive",
        onPress: () => {
          void (async () => {
            setTreeError(null);
            try {
              await deleteProjectFile(settings, project.id, selectedPath);
              setSelectedPath(null);
              setDraft("");
              await loadTree();
            } catch (e) {
              setTreeError(e instanceof Error ? e.message : String(e));
            }
          })();
        },
      },
    ]);
  };

  const showMarkdown = Boolean(
    selectedPath && isMarkdownPath(selectedPath, language) && !binary,
  );

  const modalTitle =
    modalKind === "createFile"
      ? "새 파일 경로"
      : modalKind === "createDir"
        ? "새 폴더 경로"
        : modalKind === "rename"
          ? "이름 변경"
          : "";

  return (
    <SafeAreaView style={styles.container}>
      <Pressable onPress={onBack} testID="project-back-btn">
        <Text style={styles.link}>← 프로젝트</Text>
      </Pressable>
      <Text style={styles.title}>{project.name}</Text>
      <ProjectNavBar
        active="files"
        onSessions={onSessions}
        onFiles={() => {}}
        onGit={onGit}
        onTerminal={onTerminal}
        onDiff={onDiff}
      />
      <View style={styles.toolbar} testID="files-toolbar">
        <Pressable onPress={() => openModal("createFile")} testID="files-add-file">
          <Text style={styles.link}>+파일</Text>
        </Pressable>
        <Pressable onPress={() => openModal("createDir")} testID="files-add-dir">
          <Text style={styles.link}>+폴더</Text>
        </Pressable>
        <Pressable
          disabled={!selectedPath}
          onPress={() => selectedPath && openModal("rename", selectedPath)}
        >
          <Text style={[styles.link, !selectedPath && styles.disabledLink]}>
            이름
          </Text>
        </Pressable>
        <Pressable disabled={!selectedPath} onPress={handleDelete}>
          <Text style={[styles.link, styles.dangerLink, !selectedPath && styles.disabledLink]}>
            삭제
          </Text>
        </Pressable>
        <Pressable onPress={() => void loadTree()} disabled={loadingTree}>
          <Text style={styles.link}>↻</Text>
        </Pressable>
      </View>
      <View style={styles.searchRow}>
        <TextInput
          style={styles.searchInput}
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder="파일 검색…"
          placeholderTextColor="#64748b"
          onSubmitEditing={() => void handleSearch()}
        />
        <Pressable
          style={styles.searchBtn}
          disabled={searching || !searchQuery.trim()}
          onPress={() => void handleSearch()}
        >
          <Text style={styles.searchBtnText}>{searching ? "…" : "검색"}</Text>
        </Pressable>
      </View>
      {treeError && <Text style={styles.error}>{treeError}</Text>}
      {searchHits.length > 0 && (
        <FlatList
          style={styles.searchResults}
          data={searchHits}
          keyExtractor={(item, i) => `${item.path}-${item.line}-${i}`}
          renderItem={({ item }) => (
            <Pressable
              style={styles.searchHit}
              onPress={() => void handleSelectFile(item.path)}
            >
              <Text style={styles.searchPath} numberOfLines={1}>
                {item.path}
                {item.line > 0 ? `:${item.line}` : ""}
              </Text>
              <Text style={styles.searchSnippet} numberOfLines={2}>
                {item.snippet}
              </Text>
            </Pressable>
          )}
        />
      )}
      {loadingTree && !tree ? (
        <ActivityIndicator color="#38bdf8" />
      ) : (
        <View style={styles.split}>
          <FlatList
            style={styles.treePane}
            data={flatRows}
            keyExtractor={(item) => item.key}
            initialNumToRender={24}
            maxToRenderPerBatch={32}
            windowSize={8}
            renderItem={({ item }) => (
              <Pressable
                style={[
                  item.type === "file" ? styles.fileRow : styles.dirRow,
                  { paddingLeft: item.depth * 12 + 8 },
                  selectedPath === item.path && item.type === "file" && styles.selected,
                ]}
                onPress={() => handleTreeRowPress(item)}
              >
                <Text
                  style={item.type === "file" ? styles.fileName : styles.dirName}
                  numberOfLines={1}
                >
                  {item.type === "dir"
                    ? `${item.expanded ? "▾" : "▸"} ${item.name || "/"}`
                    : item.name}
                </Text>
              </Pressable>
            )}
            ListEmptyComponent={<Text style={styles.muted}>파일 없음</Text>}
          />
          <View style={styles.viewerPane}>
            {selectedPath ? (
              <>
                <View style={styles.viewerHeader}>
                  <Text style={styles.pathLabel} numberOfLines={2}>
                    {selectedPath}
                  </Text>
                  {language ? (
                    <Text style={styles.langBadge}>{language}</Text>
                  ) : null}
                </View>
                {showMarkdown && (
                  <Pressable
                    style={styles.previewToggle}
                    onPress={() => setMdPreview((v) => !v)}
                  >
                    <Text style={styles.link}>
                      {mdPreview ? "편집" : "미리보기"}
                    </Text>
                  </Pressable>
                )}
                {loadingFile ? (
                  <ActivityIndicator color="#38bdf8" />
                ) : binary ? (
                  <Text style={styles.muted}>바이너리 파일 — 미리보기 불가</Text>
                ) : showMarkdown && mdPreview ? (
                  <SimpleMarkdownView content={draft} />
                ) : editable ? (
                  <TextInput
                    style={styles.editor}
                    value={draft}
                    onChangeText={(t) => {
                      setDraft(t);
                      setDirty(true);
                      setSaveStatus(null);
                    }}
                    multiline
                    textAlignVertical="top"
                  />
                ) : (
                  <Text style={styles.contentText}>{draft}</Text>
                )}
                {truncated && (
                  <Text style={styles.muted}>파일이 잘려 표시됩니다 — 편집 불가</Text>
                )}
                {fileError && <Text style={styles.error}>{fileError}</Text>}
                {saveStatus && <Text style={styles.ok}>{saveStatus}</Text>}
                {editable && (
                  <Pressable
                    style={[
                      styles.saveBtn,
                      (!dirty || saving) && styles.saveBtnDisabled,
                    ]}
                    disabled={!dirty || saving}
                    onPress={() => void handleSave()}
                  >
                    <Text style={styles.saveBtnText}>
                      {saving ? "저장 중…" : dirty ? "저장" : "저장됨"}
                    </Text>
                  </Pressable>
                )}
              </>
            ) : (
              <Text style={styles.muted}>파일을 선택하세요</Text>
            )}
          </View>
        </View>
      )}

      <Modal visible={modalKind !== null} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{modalTitle}</Text>
            <TextInput
              style={styles.modalInput}
              value={modalInput}
              onChangeText={setModalInput}
              placeholder="예: src/notes.md"
              placeholderTextColor="#64748b"
              autoCapitalize="none"
              autoCorrect={false}
            />
            <View style={styles.modalActions}>
              <Pressable
                style={styles.modalBtn}
                onPress={() => {
                  setModalKind(null);
                  setModalInput("");
                }}
              >
                <Text style={styles.link}>취소</Text>
              </Pressable>
              <Pressable
                style={[styles.modalBtn, styles.modalPrimary]}
                disabled={modalBusy || !modalInput.trim()}
                onPress={() => void handleModalSubmit()}
              >
                <Text style={styles.modalPrimaryText}>
                  {modalBusy ? "…" : "확인"}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0f172a",
    padding: 16,
  },
  title: {
    color: "#f8fafc",
    fontSize: 20,
    fontWeight: "700",
    marginBottom: 4,
  },
  link: { color: "#38bdf8" },
  disabledLink: { opacity: 0.4 },
  dangerLink: { color: "#f87171" },
  toolbar: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    marginBottom: 4,
  },
  searchRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 8,
  },
  searchInput: {
    flex: 1,
    backgroundColor: "#1e293b",
    color: "#f8fafc",
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 13,
  },
  searchBtn: {
    backgroundColor: "#0284c7",
    borderRadius: 6,
    paddingHorizontal: 12,
    justifyContent: "center",
  },
  searchBtnText: { color: "#fff", fontWeight: "600" },
  searchResults: {
    maxHeight: 100,
    marginBottom: 8,
    backgroundColor: "#1e293b",
    borderRadius: 6,
  },
  searchHit: {
    padding: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#334155",
  },
  searchPath: { color: "#38bdf8", fontSize: 12 },
  searchSnippet: { color: "#94a3b8", fontSize: 11, marginTop: 2 },
  error: { color: "#f87171", marginBottom: 4, fontSize: 12 },
  ok: { color: "#86efac", marginBottom: 4, fontSize: 12 },
  muted: { color: "#64748b" },
  split: { flex: 1, gap: 8 },
  treePane: {
    maxHeight: "38%",
    backgroundColor: "#1e293b",
    borderRadius: 6,
  },
  dirRow: { paddingVertical: 4 },
  dirName: { color: "#94a3b8", fontWeight: "600", fontSize: 13 },
  fileRow: { paddingVertical: 4 },
  fileName: { color: "#e2e8f0", fontSize: 13 },
  selected: { backgroundColor: "#0369a1", borderRadius: 4 },
  viewerPane: {
    flex: 1,
    backgroundColor: "#0c1222",
    borderRadius: 6,
    padding: 8,
  },
  viewerHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    marginBottom: 6,
  },
  previewToggle: { marginBottom: 6 },
  pathLabel: {
    color: "#38bdf8",
    fontSize: 12,
    flex: 1,
  },
  langBadge: {
    color: "#94a3b8",
    fontSize: 10,
    backgroundColor: "#1e293b",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  contentText: {
    color: "#e2e8f0",
    fontFamily: "monospace",
    fontSize: 11,
    flex: 1,
  },
  editor: {
    flex: 1,
    minHeight: 120,
    color: "#e2e8f0",
    fontFamily: "monospace",
    fontSize: 11,
    backgroundColor: "#1e293b",
    borderRadius: 4,
    padding: 8,
  },
  saveBtn: {
    marginTop: 8,
    backgroundColor: "#15803d",
    borderRadius: 6,
    paddingVertical: 10,
    alignItems: "center",
  },
  saveBtnDisabled: { opacity: 0.5 },
  saveBtnText: { color: "#fff", fontWeight: "600" },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "center",
    padding: 24,
  },
  modalCard: {
    backgroundColor: "#1e293b",
    borderRadius: 8,
    padding: 16,
  },
  modalTitle: {
    color: "#f8fafc",
    fontWeight: "700",
    marginBottom: 8,
  },
  modalInput: {
    backgroundColor: "#0f172a",
    color: "#f8fafc",
    borderRadius: 6,
    padding: 10,
    marginBottom: 12,
  },
  modalActions: { flexDirection: "row", justifyContent: "flex-end", gap: 16 },
  modalBtn: { padding: 8 },
  modalPrimary: {
    backgroundColor: "#0284c7",
    borderRadius: 6,
    paddingHorizontal: 16,
  },
  modalPrimaryText: { color: "#fff", fontWeight: "600" },
});
