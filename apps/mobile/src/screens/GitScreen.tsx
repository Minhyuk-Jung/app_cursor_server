import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { getProjectGit, type Project } from "../api/client";
import { ProjectNavBar } from "../components/ProjectNavBar";
import type { MobileSettings } from "../config";

export function GitScreen({
  settings,
  project,
  refreshKey = 0,
  onBack,
  onSessions,
  onFiles,
  onGit,
  onTerminal,
  onDiff,
}: {
  settings: MobileSettings;
  project: Project;
  refreshKey?: number;
  onBack: () => void;
  onSessions: () => void;
  onFiles: () => void;
  onGit: () => void;
  onTerminal: () => void;
  onDiff: () => void;
}) {
  const [branch, setBranch] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [changedCount, setChangedCount] = useState(0);
  const [stagedCount, setStagedCount] = useState(0);
  const [unstagedCount, setUnstagedCount] = useState(0);
  const [lastCommitMessage, setLastCommitMessage] = useState<string | null>(null);
  const [ahead, setAhead] = useState<number | null>(null);
  const [behind, setBehind] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const status = await getProjectGit(settings, project.id);
      setBranch(status.branch);
      setDirty(status.dirty);
      setChangedCount(status.changedCount);
      setStagedCount(status.stagedCount);
      setUnstagedCount(status.unstagedCount);
      setLastCommitMessage(status.lastCommitMessage);
      setAhead(status.ahead);
      setBehind(status.behind);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [settings, project.id]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus, refreshKey]);

  return (
    <SafeAreaView style={styles.container}>
      <Pressable onPress={onBack} testID="project-back-btn">
        <Text style={styles.link}>← 프로젝트</Text>
      </Pressable>
      <Text style={styles.title}>{project.name}</Text>
      <ProjectNavBar
        active="git"
        onSessions={onSessions}
        onFiles={onFiles}
        onGit={onGit}
        onTerminal={onTerminal}
        onDiff={onDiff}
      />
      <View style={styles.headerRow}>
        <Text style={styles.sectionTitle}>Git 상태</Text>
        <Pressable onPress={() => void loadStatus()} disabled={loading}>
          <Text style={styles.link}>새로고침</Text>
        </Pressable>
      </View>
      {error && <Text style={styles.error}>{error}</Text>}
      {loading ? (
        <ActivityIndicator color="#38bdf8" />
      ) : (
        <View style={styles.card} testID="git-status-panel">
          <Text style={styles.label}>브랜치</Text>
          <Text style={styles.value}>{branch ?? "—"}</Text>
          {lastCommitMessage ? (
            <>
              <Text style={styles.label}>최근 커밋</Text>
              <Text style={styles.valueSmall}>{lastCommitMessage}</Text>
            </>
          ) : null}
          <Text style={styles.label}>원격 동기</Text>
          <Text style={styles.valueSmall} testID="git-upstream-sync">
            {ahead !== null && behind !== null
              ? `↑${ahead} · ↓${behind}`
              : "upstream 미설정"}
          </Text>
          <Text style={styles.label}>작업 트리</Text>
          <Text style={[styles.value, dirty ? styles.dirty : styles.clean]}>
            {dirty ? `변경 ${changedCount}건` : "깨끗함"}
          </Text>
          {dirty && (
            <Text style={styles.subValue}>
              staged {stagedCount} · unstaged {unstagedCount}
            </Text>
          )}
          {dirty && (
            <Pressable style={styles.diffButton} onPress={onDiff}>
              <Text style={styles.diffButtonText}>변경 리뷰 열기</Text>
            </Pressable>
          )}
        </View>
      )}
      <Text style={styles.hint}>
        커밋·푸시·PR은 변경 리뷰 탭에서 수행합니다.
      </Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0f172a",
    padding: 16,
  },
  link: { color: "#38bdf8", marginBottom: 8 },
  title: {
    color: "#f8fafc",
    fontSize: 20,
    fontWeight: "700",
    marginBottom: 8,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  sectionTitle: { color: "#e2e8f0", fontSize: 16, fontWeight: "600" },
  error: { color: "#f87171", marginBottom: 8 },
  card: {
    backgroundColor: "#1e293b",
    borderRadius: 8,
    padding: 16,
    gap: 4,
    marginBottom: 12,
  },
  label: { color: "#94a3b8", fontSize: 12 },
  value: { color: "#f8fafc", fontSize: 16, fontWeight: "600", marginBottom: 8 },
  valueSmall: { color: "#cbd5e1", fontSize: 13, marginBottom: 8 },
  dirty: { color: "#fbbf24" },
  clean: { color: "#4ade80" },
  subValue: { color: "#94a3b8", fontSize: 13, marginBottom: 8 },
  diffButton: {
    marginTop: 8,
    backgroundColor: "#0369a1",
    borderRadius: 6,
    paddingVertical: 10,
    alignItems: "center",
  },
  diffButtonText: { color: "#f8fafc", fontWeight: "600" },
  hint: { color: "#64748b", fontSize: 12, lineHeight: 18 },
});
