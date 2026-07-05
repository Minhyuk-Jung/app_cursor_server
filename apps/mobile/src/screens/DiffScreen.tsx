import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import type { MobileSettings } from "../config";
import { ProjectNavBar } from "../components/ProjectNavBar";
import {
  commitProjectChanges,
  createProjectPullRequest,
  getProjectDiff,
  pushProject,
  rollbackProject,
  type GitChangeItem,
  type Project,
} from "../api/client";

type ReviewDecision = "pending" | "approved" | "rejected";

export function DiffScreen({
  settings,
  project,
  activeRunId,
  refreshKey = 0,
  onBack,
  onSessions,
  onFiles,
  onGit,
  onTerminal,
}: {
  settings: MobileSettings;
  project: Project;
  activeRunId?: string | null;
  refreshKey?: number;
  onBack: () => void;
  onSessions: () => void;
  onFiles: () => void;
  onGit: () => void;
  onTerminal: () => void;
}) {
  const [changes, setChanges] = useState<GitChangeItem[]>([]);
  const [hunks, setHunks] = useState<Record<string, string>>({});
  const [conflicts, setConflicts] = useState<string[]>([]);
  const [decisions, setDecisions] = useState<Record<string, ReviewDecision>>({});
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [commitMessage, setCommitMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const loadDiff = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getProjectDiff(settings, project.id);
      setChanges(data.changes);
      const map: Record<string, string> = {};
      for (const f of data.files) map[f.path] = f.hunks;
      setHunks(map);
      setConflicts(data.conflicts ?? []);
      setDecisions((prev) => {
        const next: Record<string, ReviewDecision> = {};
        for (const c of data.changes) {
          next[c.path] = prev[c.path] ?? "pending";
        }
        return next;
      });
      if (data.changes.length > 0) {
        setSelectedPath((p) => p ?? data.changes[0]!.path);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [settings, project.id]);

  useEffect(() => {
    void loadDiff();
  }, [loadDiff, refreshKey]);

  const approvedPaths = changes
    .filter((c) => decisions[c.path] === "approved")
    .map((c) => c.path);

  const handleCommit = async () => {
    if (!commitMessage.trim() || approvedPaths.length === 0) return;
    setLoading(true);
    setStatus(null);
    try {
      await commitProjectChanges(
        settings,
        project.id,
        commitMessage.trim(),
        approvedPaths,
      );
      setStatus("커밋 완료");
      setCommitMessage("");
      await loadDiff();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const handlePush = async () => {
    setLoading(true);
    setStatus(null);
    setError(null);
    try {
      const result = await pushProject(settings, project.id);
      setStatus(`푸시 완료: ${result.remote}/${result.branch}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleCreatePr = async () => {
    const title =
      commitMessage.trim() ||
      `Review: ${approvedPaths.length} file(s) from remote session`;
    setLoading(true);
    setStatus(null);
    setError(null);
    try {
      const pr = await createProjectPullRequest(settings, project.id, title);
      setStatus(`PR 생성: #${pr.number} ${pr.url}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleRollback = () => {
    if (!activeRunId) {
      setError("롤백할 실행(run)이 없습니다");
      return;
    }
    Alert.alert("스냅샷 롤백", "스냅샷으로 되돌리시겠습니까?", [
      { text: "취소", style: "cancel" },
      {
        text: "롤백",
        style: "destructive",
        onPress: () => {
          void (async () => {
            setLoading(true);
            setError(null);
            try {
              await rollbackProject(settings, project.id, { runId: activeRunId });
              setStatus("스냅샷으로 복원됨");
              await loadDiff();
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
            } finally {
              setLoading(false);
            }
          })();
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.container}>
      <Pressable onPress={onBack} testID="project-back-btn">
        <Text style={styles.link}>← 프로젝트</Text>
      </Pressable>
      <ProjectNavBar
        active="diff"
        onSessions={onSessions}
        onFiles={onFiles}
        onGit={onGit}
        onTerminal={onTerminal}
        onDiff={() => {}}
      />
      <View style={styles.headerRow}>
        <Text style={styles.title}>변경 리뷰</Text>
        <Pressable onPress={() => void loadDiff()} disabled={loading}>
          <Text style={styles.link}>새로고침</Text>
        </Pressable>
      </View>
      <Text style={styles.hint}>
        실행 중 AI 툴 승인(채팅)과 별개 — 커밋 전 변경 diff 리뷰입니다.
      </Text>
      {error && <Text style={styles.error}>{error}</Text>}
      {status && <Text style={styles.ok}>{status}</Text>}
      {conflicts.length > 0 && (
        <Text style={styles.error}>
          충돌: {conflicts.join(", ")} — merge 해소 후 커밋하세요.
        </Text>
      )}
      {loading && changes.length === 0 ? (
        <ActivityIndicator color="#38bdf8" />
      ) : changes.length === 0 ? (
        <Text style={styles.muted}>변경된 파일 없음</Text>
      ) : (
        <>
          <FlatList
            style={styles.fileList}
            data={changes}
            keyExtractor={(item) => item.path}
            renderItem={({ item }) => (
              <View style={styles.fileRow}>
                <Pressable
                  style={[
                    styles.fileItem,
                    selectedPath === item.path && styles.fileActive,
                  ]}
                  onPress={() => setSelectedPath(item.path)}
                >
                  <Text style={styles.kind}>{item.changeKind}</Text>
                  <Text style={styles.path} numberOfLines={1}>
                    {item.path}
                  </Text>
                </Pressable>
                <View style={styles.decisionRow}>
                  <Pressable
                    style={[
                      styles.decBtn,
                      decisions[item.path] === "approved" && styles.approved,
                    ]}
                    onPress={() =>
                      setDecisions((d) => ({ ...d, [item.path]: "approved" }))
                    }
                  >
                    <Text style={styles.decText}>승인</Text>
                  </Pressable>
                  <Pressable
                    style={[
                      styles.decBtn,
                      decisions[item.path] === "rejected" && styles.rejected,
                    ]}
                    onPress={() =>
                      setDecisions((d) => ({ ...d, [item.path]: "rejected" }))
                    }
                  >
                    <Text style={styles.decText}>거절</Text>
                  </Pressable>
                </View>
              </View>
            )}
          />
          {selectedPath && hunks[selectedPath] ? (
            <ScrollView style={styles.hunkBox}>
              <Text style={styles.hunkText}>{hunks[selectedPath]}</Text>
            </ScrollView>
          ) : null}
          <TextInput
            style={styles.input}
            value={commitMessage}
            onChangeText={setCommitMessage}
            placeholder="커밋 메시지"
            placeholderTextColor="#64748b"
          />
          <View style={styles.actionRow}>
            <Pressable
              style={[
                styles.actionBtn,
                (loading || approvedPaths.length === 0) && styles.disabled,
              ]}
              disabled={loading || approvedPaths.length === 0}
              onPress={() => void handleCommit()}
            >
              <Text style={styles.actionText}>
                커밋 ({approvedPaths.length})
              </Text>
            </Pressable>
            <Pressable
              style={[styles.actionBtn, loading && styles.disabled]}
              disabled={loading}
              onPress={() => void handlePush()}
            >
              <Text style={styles.actionText}>푸시</Text>
            </Pressable>
            <Pressable
              style={[styles.actionBtn, loading && styles.disabled]}
              disabled={loading}
              onPress={() => void handleCreatePr()}
            >
              <Text style={styles.actionText}>PR</Text>
            </Pressable>
            {activeRunId ? (
              <Pressable
                style={[
                  styles.actionBtn,
                  styles.dangerBtn,
                  loading && styles.disabled,
                ]}
                disabled={loading}
                onPress={handleRollback}
              >
                <Text style={styles.actionText}>롤백</Text>
              </Pressable>
            ) : null}
          </View>
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0f172a",
    padding: 16,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  title: {
    color: "#f8fafc",
    fontSize: 20,
    fontWeight: "700",
  },
  hint: {
    color: "#64748b",
    fontSize: 11,
    marginBottom: 8,
  },
  link: { color: "#38bdf8", marginBottom: 8 },
  error: { color: "#f87171", marginBottom: 8 },
  ok: { color: "#86efac", marginBottom: 8 },
  muted: { color: "#64748b" },
  fileList: { maxHeight: 180, marginBottom: 8 },
  fileRow: { marginBottom: 8 },
  fileItem: {
    backgroundColor: "#1e293b",
    borderRadius: 6,
    padding: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  fileActive: { borderWidth: 1, borderColor: "#38bdf8" },
  kind: {
    color: "#94a3b8",
    fontSize: 10,
    textTransform: "uppercase",
  },
  path: { color: "#f8fafc", flex: 1, fontSize: 13 },
  decisionRow: { flexDirection: "row", gap: 8, marginTop: 4 },
  decBtn: {
    flex: 1,
    padding: 6,
    borderRadius: 4,
    backgroundColor: "#334155",
    alignItems: "center",
  },
  approved: { backgroundColor: "#15803d" },
  rejected: { backgroundColor: "#7f1d1d" },
  decText: { color: "#fff", fontSize: 12 },
  hunkBox: {
    flex: 1,
    minHeight: 120,
    backgroundColor: "#0c1222",
    borderRadius: 6,
    padding: 8,
    marginBottom: 8,
  },
  hunkText: {
    color: "#e2e8f0",
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    fontSize: 11,
  },
  input: {
    backgroundColor: "#1e293b",
    color: "#f8fafc",
    borderRadius: 8,
    padding: 10,
    marginBottom: 8,
  },
  actionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  actionBtn: {
    backgroundColor: "#0284c7",
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    alignItems: "center",
  },
  dangerBtn: { backgroundColor: "#b91c1c" },
  disabled: { opacity: 0.5 },
  actionText: { color: "#fff", fontWeight: "600", fontSize: 13 },
});
