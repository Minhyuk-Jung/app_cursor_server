import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { MobileSettings } from "../config";
import {
  listInbox,
  markInboxRead,
  type InboxItem,
} from "../api/client";

export function InboxScreen({
  settings,
  onOpenItem,
  onBack,
}: {
  settings: MobileSettings;
  onOpenItem: (item: InboxItem) => void;
  onBack: () => void;
}) {
  const [items, setItems] = useState<InboxItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setItems(await listInbox(settings));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [settings]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const handlePress = async (item: InboxItem) => {
    if (!item.read) {
      try {
        await markInboxRead(settings, item.id);
      } catch {
        // 읽음 PATCH 실패해도 네비게이션 유지 (web InboxPanel 동일)
      }
    }
    onOpenItem(item);
  };

  return (
    <SafeAreaView style={styles.container} testID="inbox-screen">
      <View style={styles.headerRow}>
        <Pressable onPress={onBack}>
          <Text style={styles.link}>← 홈</Text>
        </Pressable>
        <Pressable onPress={() => void reload()}>
          <Text style={styles.link}>새로고침</Text>
        </Pressable>
      </View>
      <Text style={styles.title}>인박스</Text>
      {error && <Text style={styles.error}>{error}</Text>}
      {loading ? (
        <ActivityIndicator color="#38bdf8" />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          ListEmptyComponent={<Text style={styles.muted}>알림 없음</Text>}
          renderItem={({ item }) => (
            <Pressable
              style={[styles.listItem, !item.read && styles.unread]}
              onPress={() => void handlePress(item)}
              testID={`inbox-item-${item.id}`}
            >
              <Text style={styles.listTitle}>{item.title}</Text>
              <Text style={styles.summary} numberOfLines={2}>
                {item.summary}
              </Text>
              <Text style={styles.muted}>
                {item.kind}
                {item.groupCount > 1 ? ` ×${item.groupCount}` : ""}
              </Text>
            </Pressable>
          )}
        />
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
    marginBottom: 8,
  },
  link: { color: "#38bdf8" },
  error: { color: "#f87171", marginBottom: 8 },
  muted: { color: "#64748b", fontSize: 12, marginTop: 4 },
  listItem: {
    backgroundColor: "#1e293b",
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
  },
  unread: {
    borderLeftWidth: 3,
    borderLeftColor: "#38bdf8",
  },
  listTitle: {
    color: "#f8fafc",
    fontSize: 16,
    fontWeight: "600",
  },
  summary: {
    color: "#94a3b8",
    fontSize: 13,
    marginTop: 4,
  },
});
