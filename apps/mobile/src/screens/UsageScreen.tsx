import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { MobileSettings } from "../config";
import {
  getUsage,
  listProjects,
  type Project,
  type UsageSummary,
} from "../api/client";

function UsageSection({
  label,
  usage,
}: {
  label: string;
  usage: UsageSummary;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{label}</Text>
      {usage.warning && usage.limit !== undefined && (
        <Text style={styles.warningText}>
          일일 한도에 근접 ({usage.total}/{usage.limit})
        </Text>
      )}
      <Text style={[styles.total, usage.warning && styles.warning]}>
        {usage.total}회
        {usage.warning ? " ⚠" : ""}
      </Text>
      {usage.limit !== undefined && (
        <Text style={styles.muted}>
          한도 {usage.limit}
          {usage.remaining !== undefined ? ` · 잔여 ${usage.remaining}` : ""}
        </Text>
      )}
      {Object.entries(usage.byKind).map(([kind, count]) => (
        <Text key={kind} style={styles.kindRow}>
          {kind}: {count}
        </Text>
      ))}
    </View>
  );
}

export function UsageScreen({
  settings,
  onBack,
}: {
  settings: MobileSettings;
  onBack: () => void;
}) {
  const [day, setDay] = useState<UsageSummary | null>(null);
  const [month, setMonth] = useState<UsageSummary | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const pid = projectId ?? undefined;
      const [d, m] = await Promise.all([
        getUsage(settings, "day", pid),
        getUsage(settings, "month", pid),
      ]);
      setDay(d);
      setMonth(m);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [settings, projectId]);

  useEffect(() => {
    void listProjects(settings)
      .then(setProjects)
      .catch(() => setProjects([]));
  }, [settings]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const selectedProject = projects.find((p) => p.id === projectId);

  return (
    <SafeAreaView style={styles.container} testID="usage-screen">
      <View style={styles.headerRow}>
        <Pressable onPress={onBack}>
          <Text style={styles.link}>← 홈</Text>
        </Pressable>
        <Pressable onPress={() => void reload()}>
          <Text style={styles.link}>새로고침</Text>
        </Pressable>
      </View>
      <Text style={styles.title}>사용량</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterRow}>
        <Pressable
          style={[styles.filterBtn, !projectId && styles.filterActive]}
          onPress={() => setProjectId(null)}
        >
          <Text style={styles.filterText}>전체</Text>
        </Pressable>
        {projects.map((p) => (
          <Pressable
            key={p.id}
            style={[styles.filterBtn, projectId === p.id && styles.filterActive]}
            onPress={() => setProjectId(p.id)}
          >
            <Text style={styles.filterText} numberOfLines={1}>
              {p.name}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
      {selectedProject && (
        <Text style={styles.muted}>프로젝트: {selectedProject.name}</Text>
      )}
      {error && <Text style={styles.error}>{error}</Text>}
      {loading ? (
        <ActivityIndicator color="#38bdf8" />
      ) : (
        <ScrollView style={styles.scroll}>
          {day && <UsageSection label="오늘" usage={day} />}
          {month && <UsageSection label="이번 달" usage={month} />}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0f172a",
    padding: 16,
    paddingBottom: 72,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  title: {
    color: "#f8fafc",
    fontSize: 22,
    fontWeight: "700",
    marginBottom: 12,
  },
  link: { color: "#38bdf8" },
  error: { color: "#f87171", marginBottom: 8 },
  muted: { color: "#64748b", marginTop: 4, marginBottom: 8 },
  filterRow: { marginBottom: 12, maxHeight: 40 },
  filterBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: "#1e293b",
    marginRight: 8,
    maxWidth: 140,
  },
  filterActive: { backgroundColor: "#0369a1" },
  filterText: { color: "#f8fafc", fontSize: 13 },
  scroll: { flex: 1 },
  section: {
    backgroundColor: "#1e293b",
    borderRadius: 8,
    padding: 16,
    marginBottom: 12,
  },
  sectionTitle: {
    color: "#94a3b8",
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 8,
  },
  warningText: {
    color: "#fbbf24",
    fontSize: 13,
    marginBottom: 4,
  },
  total: {
    color: "#f8fafc",
    fontSize: 28,
    fontWeight: "700",
  },
  warning: { color: "#fbbf24" },
  kindRow: {
    color: "#cbd5e1",
    marginTop: 8,
  },
});
