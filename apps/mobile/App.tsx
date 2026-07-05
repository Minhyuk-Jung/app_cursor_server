import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  checkHealth,
  createProject,
  createSession,
  getProject,
  getSession,
  listProjects,
  verifyApiAccess,
  type InboxItem,
  type Project,
  type Session,
} from "./src/api/client";
import { ChatScreen } from "./src/screens/ChatScreen";
import { DiffScreen } from "./src/screens/DiffScreen";
import { FilesScreen } from "./src/screens/FilesScreen";
import { GitScreen } from "./src/screens/GitScreen";
import { InboxScreen } from "./src/screens/InboxScreen";
import { TerminalScreen } from "./src/screens/TerminalScreen";
import { UsageScreen } from "./src/screens/UsageScreen";
import {
  DEFAULT_SETTINGS,
  isMaestroE2eMode,
  loadSettings,
  saveSettings,
  type MobileSettings,
} from "./src/config";
import { tryMaestroAutoConnect } from "./src/lib/maestro-auto-connect";
import { ProjectNavBar } from "./src/components/ProjectNavBar";
import { parseDeeplink } from "@app/shared";
import {
  addNotificationResponseListener,
  getInitialNotificationDeeplink,
  registerMobilePushToken,
  unregisterMobilePushToken,
} from "./src/push/register";

type HomeTab = "projects" | "inbox" | "usage";

type Screen =
  | { name: "settings" }
  | { name: "home"; tab: HomeTab }
  | { name: "sessions"; project: Project }
  | { name: "chat"; project: Project; session: Session }
  | {
      name: "diff";
      project: Project;
      refreshKey?: number;
      activeRunId?: string | null;
    }
  | { name: "terminal"; project: Project }
  | { name: "files"; project: Project }
  | { name: "git"; project: Project; refreshKey?: number };

export default function App() {
  const [settings, setSettings] = useState<MobileSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [screen, setScreen] = useState<Screen>({ name: "settings" });
  const [error, setError] = useState<string | null>(null);
  const [pushNotice, setPushNotice] = useState<string | null>(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const navigateDeeplink = useCallback(async (deeplink: string) => {
    const current = settingsRef.current;
    if (!current) return;

    const parsed = parseDeeplink(deeplink);
    if (!parsed.projectId) return;

    if (parsed.view === "diff") {
      try {
        const project = await getProject(current, parsed.projectId);
        setScreen({ name: "diff", project, refreshKey: Date.now() });
      } catch (e) {
        Alert.alert(
          "이동 실패",
          e instanceof Error ? e.message : "프로젝트를 불러올 수 없습니다",
        );
      }
      return;
    }

    if (parsed.view === "terminal") {
      try {
        const project = await getProject(current, parsed.projectId);
        setScreen({ name: "terminal", project });
      } catch (e) {
        Alert.alert(
          "이동 실패",
          e instanceof Error ? e.message : "프로젝트를 불러올 수 없습니다",
        );
      }
      return;
    }

    if (parsed.view === "git") {
      try {
        const project = await getProject(current, parsed.projectId);
        setScreen({
          name: "git",
          project,
          refreshKey: Date.now(),
        });
      } catch (e) {
        Alert.alert(
          "이동 실패",
          e instanceof Error ? e.message : "프로젝트를 불러올 수 없습니다",
        );
      }
      return;
    }

    try {
      const project = await getProject(current, parsed.projectId);
      if (parsed.sessionId) {
        const row = await getSession(current, parsed.sessionId);
        const session: Session = {
          id: row.id,
          projectId: row.projectId,
          title: row.title,
          model: row.model,
          status: row.status,
          summary: row.summary,
        };
        setScreen({ name: "chat", project, session });
      } else {
        setScreen({ name: "sessions", project });
      }
    } catch (e) {
      Alert.alert(
        "이동 실패",
        e instanceof Error ? e.message : "deeplink 대상을 불러올 수 없습니다",
      );
    }
  }, []);

  const handleInboxItem = useCallback(
    (item: InboxItem) => {
      if (item.kind === "quota_exceeded") {
        Alert.alert(
          "사용량 한도 초과",
          item.summary || "일일 사용량 한도에 도달했습니다.",
        );
        setScreen({ name: "home", tab: "usage" });
        return;
      }
      void navigateDeeplink(item.deeplink);
    },
    [navigateDeeplink],
  );

  useEffect(() => {
    void loadSettings().then(async (saved) => {
      let active = saved;
      if (!active && isMaestroE2eMode()) {
        active = await tryMaestroAutoConnect(true, DEFAULT_SETTINGS, {
          checkHealth,
          verifyApiAccess,
          saveSettings,
          sleepMs: (ms) => new Promise((r) => setTimeout(r, ms)),
        });
      }
      if (active) {
        setSettings(active);
        setScreen({ name: "home", tab: "projects" });
        if (!isMaestroE2eMode()) {
          const result = await registerMobilePushToken(active);
          if (!result.ok) {
            setPushNotice(result.message);
          }
        }
        const initial = await getInitialNotificationDeeplink();
        if (initial) {
          void navigateDeeplink(initial);
        }
      }
      setLoading(false);
    });
  }, [navigateDeeplink]);

  useEffect(() => {
    const sub = addNotificationResponseListener((deeplink) => {
      void navigateDeeplink(deeplink);
    });
    return () => sub.remove();
  }, [navigateDeeplink]);

  const handleSaveSettings = async (next: MobileSettings) => {
    setError(null);
    setPushNotice(null);
    const ok = await checkHealth(next);
    if (!ok) {
      setError("서버 /health 연결 실패 — API URL을 확인하세요");
      return;
    }
    try {
      await verifyApiAccess(next);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "API Key 또는 권한을 확인하세요",
      );
      return;
    }
    if (settings) {
      await unregisterMobilePushToken(settings);
    }
    await saveSettings(next);
    setSettings(next);
    setScreen({ name: "home", tab: "projects" });
    if (!isMaestroE2eMode()) {
      const result = await registerMobilePushToken(next);
      if (!result.ok) {
        setPushNotice(result.message);
      }
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator color="#38bdf8" />
      </SafeAreaView>
    );
  }

  if (screen.name === "settings" || !settings) {
    return (
      <SettingsScreen
        initial={settings ?? DEFAULT_SETTINGS}
        error={error}
        onSave={(s) => void handleSaveSettings(s)}
        onBack={
          settings
            ? () => setScreen({ name: "home", tab: "projects" })
            : undefined
        }
      />
    );
  }

  if (screen.name === "home") {
    return (
      <>
        {screen.tab === "projects" ? (
          <ProjectsScreen
            settings={settings}
            pushNotice={pushNotice}
            onOpenProject={(project) =>
              setScreen({ name: "sessions", project })
            }
            onSettings={() => setScreen({ name: "settings" })}
          />
        ) : screen.tab === "inbox" ? (
          <View style={styles.flex}>
            <InboxScreen
              settings={settings}
              onOpenItem={handleInboxItem}
              onBack={() => setScreen({ name: "home", tab: "projects" })}
            />
          </View>
        ) : (
          <View style={styles.flex}>
            <UsageScreen
              settings={settings}
              onBack={() => setScreen({ name: "home", tab: "projects" })}
            />
          </View>
        )}
        <HomeTabBar
          tab={screen.tab}
          onProjects={() => setScreen({ name: "home", tab: "projects" })}
          onInbox={() => setScreen({ name: "home", tab: "inbox" })}
          onUsage={() => setScreen({ name: "home", tab: "usage" })}
        />
      </>
    );
  }

  if (screen.name === "sessions") {
    return (
      <SessionsScreen
        settings={settings}
        project={screen.project}
        onBack={() => setScreen({ name: "home", tab: "projects" })}
        onOpenDiff={() =>
          setScreen({
            name: "diff",
            project: screen.project,
            refreshKey: Date.now(),
          })
        }
        onOpenFiles={() =>
          setScreen({ name: "files", project: screen.project })
        }
        onOpenGit={() =>
          setScreen({
            name: "git",
            project: screen.project,
            refreshKey: Date.now(),
          })
        }
        onOpenTerminal={() =>
          setScreen({ name: "terminal", project: screen.project })
        }
        onOpenSession={(session) =>
          setScreen({ name: "chat", project: screen.project, session })
        }
      />
    );
  }

  if (screen.name === "diff") {
    return (
      <DiffScreen
        settings={settings}
        project={screen.project}
        activeRunId={screen.activeRunId}
        refreshKey={screen.refreshKey ?? 0}
        onBack={() => setScreen({ name: "home", tab: "projects" })}
        onSessions={() =>
          setScreen({ name: "sessions", project: screen.project })
        }
        onFiles={() =>
          setScreen({ name: "files", project: screen.project })
        }
        onGit={() =>
          setScreen({
            name: "git",
            project: screen.project,
            refreshKey: Date.now(),
          })
        }
        onTerminal={() =>
          setScreen({ name: "terminal", project: screen.project })
        }
      />
    );
  }

  if (screen.name === "git") {
    return (
      <GitScreen
        settings={settings}
        project={screen.project}
        refreshKey={screen.refreshKey ?? 0}
        onBack={() => setScreen({ name: "home", tab: "projects" })}
        onSessions={() =>
          setScreen({ name: "sessions", project: screen.project })
        }
        onFiles={() =>
          setScreen({ name: "files", project: screen.project })
        }
        onGit={() => {}}
        onTerminal={() =>
          setScreen({ name: "terminal", project: screen.project })
        }
        onDiff={() =>
          setScreen({
            name: "diff",
            project: screen.project,
            refreshKey: Date.now(),
          })
        }
      />
    );
  }

  if (screen.name === "files") {
    return (
      <FilesScreen
        settings={settings}
        project={screen.project}
        onBack={() => setScreen({ name: "home", tab: "projects" })}
        onSessions={() =>
          setScreen({ name: "sessions", project: screen.project })
        }
        onGit={() =>
          setScreen({
            name: "git",
            project: screen.project,
            refreshKey: Date.now(),
          })
        }
        onTerminal={() =>
          setScreen({ name: "terminal", project: screen.project })
        }
        onDiff={() =>
          setScreen({
            name: "diff",
            project: screen.project,
            refreshKey: Date.now(),
          })
        }
      />
    );
  }

  if (screen.name === "terminal") {
    return (
      <TerminalScreen
        settings={settings}
        project={screen.project}
        onBack={() => setScreen({ name: "home", tab: "projects" })}
        onSessions={() =>
          setScreen({ name: "sessions", project: screen.project })
        }
        onFiles={() =>
          setScreen({ name: "files", project: screen.project })
        }
        onGit={() =>
          setScreen({
            name: "git",
            project: screen.project,
            refreshKey: Date.now(),
          })
        }
        onDiff={() =>
          setScreen({
            name: "diff",
            project: screen.project,
            refreshKey: Date.now(),
          })
        }
      />
    );
  }

  if (screen.name === "chat") {
    return (
      <ChatScreen
        settings={settings}
        session={screen.session}
        projectId={screen.project.id}
        onBack={() =>
          setScreen({ name: "sessions", project: screen.project })
        }
        onOpenDiff={(activeRunId) =>
          setScreen({
            name: "diff",
            project: screen.project,
            refreshKey: Date.now(),
            activeRunId,
          })
        }
      />
    );
  }

  return null;
}

function HomeTabBar({
  tab,
  onProjects,
  onInbox,
  onUsage,
}: {
  tab: HomeTab;
  onProjects: () => void;
  onInbox: () => void;
  onUsage: () => void;
}) {
  return (
    <View style={styles.tabBar}>
      <Pressable
        style={[styles.tabItem, tab === "projects" && styles.tabActive]}
        onPress={onProjects}
        testID="home-tab-projects"
      >
        <Text style={styles.tabText}>프로젝트</Text>
      </Pressable>
      <Pressable
        style={[styles.tabItem, tab === "inbox" && styles.tabActive]}
        onPress={onInbox}
        testID="home-tab-inbox"
      >
        <Text style={styles.tabText}>인박스</Text>
      </Pressable>
      <Pressable
        style={[styles.tabItem, tab === "usage" && styles.tabActive]}
        onPress={onUsage}
        testID="home-tab-usage"
      >
        <Text style={styles.tabText}>사용량</Text>
      </Pressable>
    </View>
  );
}

function SettingsScreen({
  initial,
  error,
  onSave,
  onBack,
}: {
  initial: MobileSettings;
  error: string | null;
  onSave: (s: MobileSettings) => void;
  onBack?: () => void;
}) {
  const [apiBaseUrl, setApiBaseUrl] = useState(initial.apiBaseUrl);
  const [apiKey, setApiKey] = useState(initial.apiKey);

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="light" />
      {onBack ? (
        <Pressable onPress={onBack} testID="settings-back-btn">
          <Text style={styles.link}>← 뒤로</Text>
        </Pressable>
      ) : null}
      <Text style={styles.title}>Cursor Remote Dev</Text>
      <Text style={styles.subtitle}>P7 네이티브 클라이언트 — API 설정</Text>
      {error && <Text style={styles.error}>{error}</Text>}
      <Text style={styles.label}>API Base URL</Text>
      <TextInput
        style={styles.input}
        value={apiBaseUrl}
        onChangeText={setApiBaseUrl}
        autoCapitalize="none"
        autoCorrect={false}
        placeholder="http://192.168.0.10:3000"
        placeholderTextColor="#64748b"
      />
      <Text style={styles.label}>API Key</Text>
      <TextInput
        style={styles.input}
        value={apiKey}
        onChangeText={setApiKey}
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry
        placeholderTextColor="#64748b"
      />
      <Pressable
        style={styles.primaryBtn}
        onPress={() => onSave({ apiBaseUrl, apiKey })}
        testID="settings-save-btn"
      >
        <Text style={styles.primaryBtnText}>저장 후 연결</Text>
      </Pressable>
    </SafeAreaView>
  );
}

function ProjectsScreen({
  settings,
  pushNotice,
  onOpenProject,
  onSettings,
}: {
  settings: MobileSettings;
  pushNotice: string | null;
  onOpenProject: (p: Project) => void;
  onSettings: () => void;
}) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setProjects(await listProjects(settings));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [settings]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return (
    <SafeAreaView style={[styles.container, styles.withTabBar]}>
      <StatusBar style="light" />
      <View style={styles.headerRow}>
        <Text style={styles.title}>프로젝트</Text>
        <View style={styles.headerActions}>
          <Pressable
            onPress={() => {
              void (async () => {
                try {
                  const name = `mobile-${Date.now()}`;
                  await createProject(settings, name);
                  await reload();
                } catch (e) {
                  setError(e instanceof Error ? e.message : String(e));
                }
              })();
            }}
          >
            <Text style={styles.link}>+</Text>
          </Pressable>
          <Pressable onPress={onSettings} testID="settings-open-btn">
            <Text style={styles.link}>설정</Text>
          </Pressable>
        </View>
      </View>
      {pushNotice && (
        <Text style={styles.pushNotice}>푸시: {pushNotice}</Text>
      )}
      {error && <Text style={styles.error}>{error}</Text>}
      {loading ? (
        <ActivityIndicator color="#38bdf8" />
      ) : (
        <FlatList
          data={projects}
          keyExtractor={(item) => item.id}
          ListEmptyComponent={
            <Text style={styles.muted}>프로젝트 없음</Text>
          }
          renderItem={({ item }) => (
            <Pressable style={styles.listItem} onPress={() => onOpenProject(item)}>
              <Text style={styles.listTitle}>{item.name}</Text>
              <Text style={styles.muted}>{item.status}</Text>
            </Pressable>
          )}
        />
      )}
    </SafeAreaView>
  );
}

function SessionsScreen({
  settings,
  project,
  onBack,
  onOpenDiff,
  onOpenFiles,
  onOpenGit,
  onOpenTerminal,
  onOpenSession,
}: {
  settings: MobileSettings;
  project: Project;
  onBack: () => void;
  onOpenDiff: () => void;
  onOpenFiles: () => void;
  onOpenGit: () => void;
  onOpenTerminal: () => void;
  onOpenSession: (s: Session) => void;
}) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const detail = await getProject(settings, project.id);
      setSessions(detail.sessions ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [settings, project.id]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const handleCreate = async () => {
    setError(null);
    try {
      await createSession(settings, project.id, `mobile-${Date.now()}`);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="light" />
      <View style={styles.headerRow}>
        <Pressable onPress={onBack} testID="project-back-btn">
          <Text style={styles.link}>← 프로젝트</Text>
        </Pressable>
        <Pressable onPress={() => void handleCreate()}>
          <Text style={styles.link}>+ 세션</Text>
        </Pressable>
      </View>
      <Text style={styles.title}>{project.name}</Text>
      <ProjectNavBar
        active="sessions"
        onSessions={() => {}}
        onFiles={onOpenFiles}
        onGit={onOpenGit}
        onTerminal={onOpenTerminal}
        onDiff={onOpenDiff}
      />
      {error && <Text style={styles.error}>{error}</Text>}
      {loading ? (
        <ActivityIndicator color="#38bdf8" />
      ) : (
        <FlatList
          data={sessions}
          keyExtractor={(item) => item.id}
          ListEmptyComponent={<Text style={styles.muted}>세션 없음</Text>}
          renderItem={({ item }) => (
            <Pressable style={styles.listItem} onPress={() => onOpenSession(item)}>
              <Text style={styles.listTitle}>
                {item.title ?? item.id.slice(0, 8)}
              </Text>
              {item.summary ? (
                <Text style={styles.summary} numberOfLines={2}>
                  {item.summary}
                </Text>
              ) : null}
              <Text style={styles.muted}>{item.status}</Text>
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
  },
  flex: { flex: 1 },
  withTabBar: {
    paddingBottom: 56,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#0f172a",
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  headerActions: {
    flexDirection: "row",
    gap: 12,
  },
  title: {
    color: "#f8fafc",
    fontSize: 22,
    fontWeight: "700",
    marginBottom: 8,
  },
  subtitle: {
    color: "#94a3b8",
    marginBottom: 16,
  },
  label: {
    color: "#cbd5e1",
    marginBottom: 4,
    marginTop: 8,
  },
  input: {
    backgroundColor: "#1e293b",
    color: "#f8fafc",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 8,
  },
  primaryBtn: {
    backgroundColor: "#0284c7",
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: "center",
    marginTop: 8,
  },
  primaryBtnText: {
    color: "#fff",
    fontWeight: "600",
  },
  link: {
    color: "#38bdf8",
    marginBottom: 8,
  },
  error: {
    color: "#f87171",
    marginBottom: 8,
  },
  pushNotice: {
    color: "#fbbf24",
    fontSize: 12,
    marginBottom: 8,
  },
  muted: {
    color: "#64748b",
  },
  listItem: {
    backgroundColor: "#1e293b",
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
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
  tabBar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    backgroundColor: "#1e293b",
    borderTopWidth: 1,
    borderTopColor: "#334155",
  },
  tabItem: {
    flex: 1,
    paddingVertical: 14,
    alignItems: "center",
  },
  tabActive: {
    borderTopWidth: 2,
    borderTopColor: "#38bdf8",
  },
  tabText: {
    color: "#f8fafc",
    fontWeight: "600",
  },
});
