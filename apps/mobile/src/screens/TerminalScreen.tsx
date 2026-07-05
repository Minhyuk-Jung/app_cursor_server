import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Linking,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { WebView } from "react-native-webview";
import { issuePreview, type Project } from "../api/client";
import type { MobileSettings } from "../config";
import { ProjectNavBar } from "../components/ProjectNavBar";
import { useTerminalConnection } from "../hooks/useTerminalConnection";

interface TerminalLine {
  id: string;
  stream: "stdout" | "stderr" | "system";
  text: string;
}

const connStatusLabel: Record<string, string> = {
  connecting: "연결 중",
  connected: "인증 중",
  ready: "준비됨",
  disconnected: "끊김",
  reconnecting: "재연결…",
};

export function TerminalScreen({
  settings,
  project,
  onBack,
  onSessions,
  onFiles,
  onGit,
  onDiff,
}: {
  settings: MobileSettings;
  project: Project;
  onBack: () => void;
  onSessions: () => void;
  onFiles: () => void;
  onGit: () => void;
  onDiff: () => void;
}) {
  const [lines, setLines] = useState<TerminalLine[]>([]);
  const [command, setCommand] = useState("");
  const [stdinLine, setStdinLine] = useState("");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewPort, setPreviewPort] = useState("5173");
  const [showPreview, setShowPreview] = useState(false);
  const lineId = useRef(0);
  const listRef = useRef<FlatList<TerminalLine>>(null);

  const appendLine = useCallback((stream: TerminalLine["stream"], text: string) => {
    lineId.current += 1;
    setLines((prev) => {
      const next = [...prev, { id: String(lineId.current), stream, text }];
      return next.length > 5000 ? next.slice(-4000) : next;
    });
  }, []);

  const { connStatus, connected, ready, running, sendExec, sendCancel, sendStdin } =
    useTerminalConnection(settings, project.id, appendLine);

  useEffect(() => {
    if (lines.length === 0) return;
    const timer = setTimeout(() => {
      listRef.current?.scrollToEnd({ animated: true });
    }, 50);
    return () => clearTimeout(timer);
  }, [lines.length]);

  const handleExec = () => {
    if (sendExec(command)) setCommand("");
  };

  const handleStdin = () => {
    if (sendStdin(stdinLine)) setStdinLine("");
  };

  const handlePreview = async () => {
    const port = Number(previewPort);
    if (!port) return;
    try {
      const data = await issuePreview(settings, project.id, port);
      const url = `${settings.apiBaseUrl}${data.previewPath}`;
      setPreviewUrl(url);
      setShowPreview(true);
      appendLine("system", `프리뷰 URL: ${url}\n`);
    } catch (e) {
      appendLine("stderr", `${e instanceof Error ? e.message : String(e)}\n`);
    }
  };

  const statusLabel = connStatusLabel[connStatus] ?? connStatus;

  return (
    <SafeAreaView style={styles.container}>
      <Pressable onPress={onBack} testID="project-back-btn">
        <Text style={styles.link}>← 프로젝트</Text>
      </Pressable>
      <Text style={styles.title}>{project.name}</Text>
      <ProjectNavBar
        active="terminal"
        onSessions={onSessions}
        onFiles={onFiles}
        onGit={onGit}
        onTerminal={() => {}}
        onDiff={onDiff}
      />
      <View style={styles.toolbar}>
        <Text style={[styles.badge, ready && styles.badgeOk]}>{statusLabel}</Text>
        {running && (
          <Pressable onPress={sendCancel}>
            <Text style={styles.link}>중지</Text>
          </Pressable>
        )}
        <TextInput
          style={styles.portInput}
          value={previewPort}
          onChangeText={setPreviewPort}
          keyboardType="number-pad"
          placeholder="포트"
          placeholderTextColor="#64748b"
        />
        <Pressable onPress={() => void handlePreview()}>
          <Text style={styles.link}>프리뷰</Text>
        </Pressable>
        {previewUrl && (
          <>
            <Pressable onPress={() => setShowPreview((v) => !v)}>
              <Text style={styles.link}>
                {showPreview ? "프리뷰 닫기" : "앱 내 보기"}
              </Text>
            </Pressable>
            <Pressable onPress={() => void Linking.openURL(previewUrl)}>
              <Text style={styles.link}>브라우저</Text>
            </Pressable>
          </>
        )}
      </View>
      {!connected && lines.length === 0 && (
        <ActivityIndicator color="#38bdf8" style={styles.loader} />
      )}
      {showPreview && previewUrl ? (
        <View style={styles.previewPane}>
          <WebView
            source={{ uri: previewUrl }}
            style={styles.webview}
            startInLoadingState
            renderLoading={() => (
              <ActivityIndicator color="#38bdf8" style={styles.loader} />
            )}
          />
        </View>
      ) : (
        <FlatList
          ref={listRef}
          style={styles.output}
          data={lines}
          keyExtractor={(item) => item.id}
          onContentSizeChange={() =>
            listRef.current?.scrollToEnd({ animated: false })
          }
          renderItem={({ item }) => (
            <Text
              style={[
                styles.line,
                item.stream === "stderr"
                  ? styles.lineStderr
                  : item.stream === "system"
                    ? styles.lineSystem
                    : styles.lineStdout,
              ]}
            >
              {item.text}
            </Text>
          )}
        />
      )}
      <View style={styles.inputRow}>
        <Text style={styles.prompt}>$</Text>
        <TextInput
          style={styles.cmdInput}
          value={command}
          onChangeText={setCommand}
          placeholder="npm test"
          placeholderTextColor="#64748b"
          editable={connected && ready}
          onSubmitEditing={handleExec}
        />
        <Pressable
          style={[
            styles.runBtn,
            (!connected || !ready || !command.trim()) && styles.disabled,
          ]}
          disabled={!connected || !ready || !command.trim()}
          onPress={handleExec}
        >
          <Text style={styles.runText}>실행</Text>
        </Pressable>
      </View>
      {running && (
        <View style={styles.inputRow}>
          <Text style={styles.prompt}>{">"}</Text>
          <TextInput
            style={styles.cmdInput}
            value={stdinLine}
            onChangeText={setStdinLine}
            placeholder="stdin"
            placeholderTextColor="#64748b"
            onSubmitEditing={handleStdin}
          />
          <Pressable style={styles.runBtn} onPress={handleStdin}>
            <Text style={styles.runText}>전송</Text>
          </Pressable>
        </View>
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
  title: {
    color: "#f8fafc",
    fontSize: 20,
    fontWeight: "700",
    marginBottom: 4,
  },
  link: { color: "#38bdf8" },
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 8,
  },
  badge: {
    color: "#94a3b8",
    fontSize: 12,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: "#1e293b",
    borderRadius: 4,
  },
  badgeOk: { color: "#86efac" },
  portInput: {
    width: 64,
    backgroundColor: "#1e293b",
    color: "#f8fafc",
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    fontSize: 13,
  },
  loader: { marginVertical: 8 },
  output: {
    flex: 1,
    backgroundColor: "#0c1222",
    borderRadius: 6,
    padding: 8,
    marginBottom: 8,
  },
  previewPane: {
    flex: 1,
    marginBottom: 8,
    borderRadius: 6,
    overflow: "hidden",
    backgroundColor: "#0c1222",
  },
  webview: { flex: 1, backgroundColor: "#fff" },
  line: {
    fontFamily: "monospace",
    fontSize: 11,
    color: "#e2e8f0",
  },
  lineStdout: { color: "#e2e8f0" },
  lineStderr: { color: "#f87171" },
  lineSystem: { color: "#94a3b8" },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 8,
  },
  prompt: { color: "#38bdf8", fontWeight: "700" },
  cmdInput: {
    flex: 1,
    backgroundColor: "#1e293b",
    color: "#f8fafc",
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 13,
  },
  runBtn: {
    backgroundColor: "#0284c7",
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  disabled: { opacity: 0.5 },
  runText: { color: "#fff", fontWeight: "600" },
});
