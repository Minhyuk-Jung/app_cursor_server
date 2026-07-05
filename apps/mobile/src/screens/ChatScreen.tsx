import { Audio } from "expo-av";
import * as ImagePicker from "expo-image-picker";
import { useEffect, useRef, useState } from "react";
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import type { ConnectionStatus } from "../api/event-stream";
import {
  ApiError,
  cancelRun,
  getUsage,
  resolveApproval,
  sendPrompt,
  steerRun,
  transcribeAudio,
  uploadAttachmentBase64,
  type PromptAttachment,
  type Session,
  type UsageSummary,
} from "../api/client";
import { MessageAttachmentImage } from "../components/MessageAttachmentImage";
import type { MobileSettings } from "../config";
import { MAX_ATTACHMENT_BYTES } from "../config";
import { useSessionStream } from "../hooks/useSessionStream";
import { canSteerRun, userMessageDisplayContent } from "../state/session-ui";

const connLabel: Record<ConnectionStatus, string> = {
  idle: "idle",
  connecting: "연결 중…",
  connected: "connected",
  reconnecting: "재연결…",
  disconnected: "disconnected",
};

function isQuotaBlocked(usage: UsageSummary | null): boolean {
  if (!usage || usage.limit === undefined) return false;
  return usage.remaining !== undefined
    ? usage.remaining <= 0
    : usage.total >= usage.limit;
}

function appendTranscript(prev: string, transcript: string): string {
  const t = transcript.trim();
  if (!t) return prev;
  return prev.trim() ? `${prev.trim()} ${t}` : t;
}

function attachmentByteSize(asset: ImagePicker.ImagePickerAsset): number {
  if (asset.fileSize && asset.fileSize > 0) return asset.fileSize;
  if (asset.base64) {
    const padding = asset.base64.endsWith("==")
      ? 2
      : asset.base64.endsWith("=")
        ? 1
        : 0;
    return Math.floor((asset.base64.length * 3) / 4) - padding;
  }
  return 0;
}

async function uploadImageAsset(
  settings: MobileSettings,
  projectId: string,
  asset: ImagePicker.ImagePickerAsset,
): Promise<PromptAttachment> {
  const size = attachmentByteSize(asset);
  if (size > MAX_ATTACHMENT_BYTES) {
    throw new Error(
      `첨부 크기 초과 (${Math.round(size / 1024 / 1024)}MB / 10MB 한도)`,
    );
  }
  if (!asset.base64) {
    throw new Error("이미지 데이터를 읽을 수 없습니다");
  }
  const uploaded = await uploadAttachmentBase64(
    settings,
    projectId,
    asset.base64,
    asset.mimeType ?? "image/jpeg",
  );
  return { kind: "image", ref: uploaded.ref, mime: uploaded.mime };
}

export function ChatScreen({
  settings,
  session,
  projectId,
  onBack,
  onOpenDiff,
}: {
  settings: MobileSettings;
  session: Session;
  projectId: string;
  onBack: () => void;
  onOpenDiff?: (activeRunId?: string | null) => void;
}) {
  const {
    uiState,
    connStatus,
    reloadMessages,
    loadOlderMessages,
    hasMoreMessages,
    loadingOlder,
    setUiState,
  } = useSessionStream(settings, session.id);

  const [text, setText] = useState("");
  const [steerMode, setSteerMode] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [pendingAttachments, setPendingAttachments] = useState<PromptAttachment[]>([]);
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [attachBusy, setAttachBusy] = useState(false);
  const listRef = useRef<FlatList>(null);

  const steerAllowed = canSteerRun(uiState.activeRunId, uiState.runStatus);
  const quotaBlocked = isQuotaBlocked(usage);

  useEffect(() => {
    if (!steerAllowed && steerMode) setSteerMode(false);
  }, [steerAllowed, steerMode]);

  useEffect(() => {
    const load = () => {
      void getUsage(settings, "day", projectId)
        .then(setUsage)
        .catch(() => {});
    };
    load();
    const timer = setInterval(load, 15_000);
    return () => clearInterval(timer);
  }, [settings, projectId]);

  useEffect(() => {
    return () => {
      void recording?.stopAndUnloadAsync();
    };
  }, [recording]);

  const pickAndUploadImage = async (
    launch: () => Promise<ImagePicker.ImagePickerResult>,
  ) => {
    setError(null);
    setAttachBusy(true);
    try {
      const result = await launch();
      if (result.canceled || !result.assets[0]) return;
      const uploaded = await uploadImageAsset(settings, projectId, result.assets[0]);
      setPendingAttachments((prev) => [...prev, uploaded]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setAttachBusy(false);
    }
  };

  const handlePickImage = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      setError("사진 라이브러리 권한이 필요합니다");
      return;
    }
    await pickAndUploadImage(() =>
      ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.8,
        base64: true,
      }),
    );
  };

  const handlePickCamera = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      setError("카메라 권한이 필요합니다");
      return;
    }
    await pickAndUploadImage(() =>
      ImagePicker.launchCameraAsync({
        quality: 0.8,
        base64: true,
      }),
    );
  };

  const handleRemovePending = (index: number) => {
    setPendingAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  const handleToggleVoice = async () => {
    setError(null);
    if (recording) {
      setVoiceBusy(true);
      try {
        await recording.stopAndUnloadAsync();
        const uri = recording.getURI();
        setRecording(null);
        if (uri) {
          const { transcript } = await transcribeAudio(settings, uri);
          setText((prev) => appendTranscript(prev, transcript));
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setVoiceBusy(false);
      }
      return;
    }
    const perm = await Audio.requestPermissionsAsync();
    if (!perm.granted) {
      setError("마이크 권한이 필요합니다");
      return;
    }
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: true,
      playsInSilentModeIOS: true,
    });
    const rec = new Audio.Recording();
    await rec.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
    await rec.startAsync();
    setRecording(rec);
  };

  const handleSend = async () => {
    const trimmed = text.trim();
    if ((!trimmed && pendingAttachments.length === 0) || sending) return;

    if (steerMode) {
      if (!steerAllowed) {
        setError("steer 불가: 진행 중 run이 없거나 승인 대기 중입니다");
        return;
      }
    } else if (quotaBlocked) {
      setError("일일 사용량 한도에 도달했습니다. 내일 다시 시도하세요.");
      return;
    }

    const savedText = text;
    const savedAttachments = [...pendingAttachments];
    const optimisticId = `u-${Date.now()}`;

    setSending(true);
    setError(null);
    setText("");
    setPendingAttachments([]);
    setUiState((s) => ({
      ...s,
      messages: [
        ...s.messages,
        {
          id: optimisticId,
          role: "user",
          content: trimmed || "(첨부)",
          attachments: savedAttachments.length ? savedAttachments : undefined,
        },
      ],
    }));

    try {
      if (steerMode && steerAllowed && uiState.activeRunId) {
        await steerRun(settings, uiState.activeRunId, trimmed);
      } else {
        await sendPrompt(
          settings,
          session.id,
          trimmed || "(첨부)",
          savedAttachments.length ? savedAttachments : undefined,
        );
      }
      await reloadMessages();
      listRef.current?.scrollToEnd({ animated: true });
    } catch (e) {
      setText(savedText);
      setPendingAttachments(savedAttachments);
      setUiState((s) => ({
        ...s,
        messages: s.messages.filter((m) => m.id !== optimisticId),
      }));
      if (e instanceof ApiError && e.code === "quota_exceeded") {
        setError("사용량 한도 초과 — 전송이 차단되었습니다");
        void getUsage(settings, "day", projectId).then(setUsage).catch(() => {});
      } else {
        setError(e instanceof Error ? e.message : String(e));
      }
      await reloadMessages();
    } finally {
      setSending(false);
    }
  };

  const handleCancel = async () => {
    if (!uiState.activeRunId) return;
    try {
      await cancelRun(settings, uiState.activeRunId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleApproval = async (decision: "approve" | "reject") => {
    const approval = uiState.pendingApproval;
    if (!approval) return;
    try {
      await resolveApproval(settings, approval.approvalId, decision);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const sendDisabled =
    sending ||
    voiceBusy ||
    attachBusy ||
    Boolean(recording) ||
    (!steerMode && quotaBlocked);

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="light" />
      <Pressable onPress={onBack}>
        <Text style={styles.link}>← 세션</Text>
      </Pressable>
      <View style={styles.headerRow}>
        <Text style={styles.title}>
          {session.title ?? session.id.slice(0, 8)}
        </Text>
        <View style={styles.headerBadges}>
          {usage !== null && (
            <Text
              style={[
                styles.usageBadge,
                (usage.warning || quotaBlocked) && styles.usageWarning,
              ]}
            >
              오늘 {usage.total}회
              {quotaBlocked ? " ⛔" : usage.warning ? " ⚠" : ""}
            </Text>
          )}
          <Text style={styles.conn}>{connLabel[connStatus]}</Text>
        </View>
      </View>
      {uiState.runStatus && (
        <Text style={styles.muted}>run: {uiState.runStatus}</Text>
      )}
      {quotaBlocked && !steerMode && (
        <Text style={styles.quotaBlock}>
          일일 사용량 한도 도달 — 새 프롬프트 전송 불가
        </Text>
      )}
      {error && <Text style={styles.error}>{error}</Text>}

      {hasMoreMessages && (
        <Pressable
          style={styles.loadMoreBtn}
          disabled={loadingOlder}
          onPress={() => void loadOlderMessages()}
        >
          <Text style={styles.link}>
            {loadingOlder ? "불러오는 중…" : "이전 메시지 더 보기"}
          </Text>
        </Pressable>
      )}

      <FlatList
        ref={listRef}
        style={styles.chatList}
        data={uiState.messages}
        keyExtractor={(item) => item.id}
        onContentSizeChange={() =>
          listRef.current?.scrollToEnd({ animated: false })
        }
        renderItem={({ item }) => (
          <View
            style={[
              styles.bubble,
              item.role === "user" ? styles.userBubble : styles.assistantBubble,
            ]}
          >
            <Text style={styles.bubbleRole}>{item.role}</Text>
            <Text style={styles.bubbleText}>
              {item.role === "user"
                ? userMessageDisplayContent(item.content, item.attachments)
                : item.content}
              {item.streaming ? " …" : ""}
            </Text>
            {item.attachments?.map((att) =>
              att.kind === "image" ? (
                <MessageAttachmentImage
                  key={att.ref}
                  settings={settings}
                  projectId={projectId}
                  attachmentRef={att.ref}
                  mime={att.mime}
                />
              ) : (
                <Text key={att.ref} style={styles.attachMeta}>
                  📎 {att.kind} ({att.ref.slice(0, 8)}…)
                </Text>
              ),
            )}
          </View>
        )}
      />

      {uiState.workItems.length > 0 && (
        <View style={styles.workPanel}>
          <Text style={styles.workTitle}>작업 현황</Text>
          {uiState.workItems.slice(-5).map((w) => (
            <Text key={w.id} style={styles.workItem} numberOfLines={2}>
              {w.type}: {w.summary}
            </Text>
          ))}
          {onOpenDiff &&
            uiState.workItems.some((w) => w.type === "file_change") && (
              <Pressable onPress={() => onOpenDiff(uiState.activeRunId)}>
                <Text style={styles.link}>변경 리뷰 열기</Text>
              </Pressable>
            )}
        </View>
      )}

      {uiState.pendingApproval && (
        <View style={styles.approvalBox}>
          <Text style={styles.approvalLabel}>실행 중 승인 (AI 툴)</Text>
          <Text style={styles.approvalText} numberOfLines={3}>
            {uiState.pendingApproval.detail}
          </Text>
          <View style={styles.approvalRow}>
            <Pressable
              style={styles.approveBtn}
              onPress={() => void handleApproval("approve")}
            >
              <Text style={styles.primaryBtnText}>승인</Text>
            </Pressable>
            <Pressable
              style={styles.rejectBtn}
              onPress={() => void handleApproval("reject")}
            >
              <Text style={styles.primaryBtnText}>거부</Text>
            </Pressable>
          </View>
        </View>
      )}

      {steerAllowed && (
        <Pressable
          style={styles.steerToggle}
          onPress={() => setSteerMode((v) => !v)}
        >
          <Text style={[styles.link, steerMode && styles.steerOn]}>
            {steerMode ? "steer ON" : "추가 지시 (steer)"}
          </Text>
        </Pressable>
      )}

      {uiState.activeRunId && (
        <Pressable style={styles.cancelBtn} onPress={() => void handleCancel()}>
          <Text style={styles.link}>실행 취소</Text>
        </Pressable>
      )}

      {pendingAttachments.length > 0 && (
        <ScrollView
          horizontal
          style={styles.pendingRow}
          contentContainerStyle={styles.pendingContent}
        >
          {pendingAttachments.map((att, index) => (
            <View key={`${att.ref}-${index}`} style={styles.pendingChip}>
              <MessageAttachmentImage
                settings={settings}
                projectId={projectId}
                attachmentRef={att.ref}
                mime={att.mime}
              />
              <Pressable
                style={styles.pendingRemove}
                onPress={() => handleRemovePending(index)}
              >
                <Text style={styles.pendingRemoveText}>✕</Text>
              </Pressable>
            </View>
          ))}
        </ScrollView>
      )}

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={styles.composer}>
          <View style={styles.attachRow}>
            <Pressable
              style={styles.attachBtn}
              disabled={steerMode || sending || attachBusy}
              onPress={() => void handlePickImage()}
            >
              <Text style={styles.attachText}>📷</Text>
            </Pressable>
            <Pressable
              style={styles.attachBtn}
              disabled={steerMode || sending || attachBusy}
              onPress={() => void handlePickCamera()}
            >
              <Text style={styles.attachText}>📸</Text>
            </Pressable>
            <Pressable
              style={[
                styles.attachBtn,
                recording && styles.attachBtnActive,
              ]}
              disabled={sending || voiceBusy}
              onPress={() => void handleToggleVoice()}
            >
              <Text style={styles.attachText}>
                {recording ? "⏹" : voiceBusy ? "…" : "🎤"}
              </Text>
            </Pressable>
          </View>
          <TextInput
            style={[styles.input, styles.composerInput]}
            value={text}
            onChangeText={setText}
            placeholder={
              steerMode
                ? "진행 중 run에 추가 지시…"
                : quotaBlocked
                  ? "사용량 한도 도달"
                  : recording
                    ? "녹음 중…"
                    : "지시를 입력…"
            }
            placeholderTextColor="#64748b"
            multiline
            editable={!sendDisabled || steerMode}
          />
          <Pressable
            style={[styles.primaryBtn, sendDisabled && styles.disabledBtn]}
            disabled={sendDisabled}
            onPress={() => void handleSend()}
          >
            <Text style={styles.primaryBtnText}>
              {sending ? "…" : steerMode ? "steer" : "전송"}
            </Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
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
  },
  headerBadges: { alignItems: "flex-end" },
  title: {
    color: "#f8fafc",
    fontSize: 20,
    fontWeight: "700",
    flex: 1,
  },
  usageBadge: {
    color: "#94a3b8",
    fontSize: 11,
    marginBottom: 2,
  },
  usageWarning: { color: "#fbbf24", fontWeight: "600" },
  conn: { color: "#64748b", fontSize: 12 },
  link: { color: "#38bdf8", marginBottom: 8 },
  error: { color: "#f87171", marginBottom: 8 },
  quotaBlock: { color: "#fbbf24", fontSize: 12, marginBottom: 4 },
  muted: { color: "#64748b", marginBottom: 4 },
  loadMoreBtn: { alignItems: "center", marginBottom: 8 },
  chatList: { flex: 1, marginVertical: 4 },
  bubble: {
    borderRadius: 8,
    padding: 10,
    marginBottom: 8,
    maxWidth: "92%",
  },
  userBubble: { alignSelf: "flex-end", backgroundColor: "#0369a1" },
  assistantBubble: { alignSelf: "flex-start", backgroundColor: "#334155" },
  bubbleRole: {
    color: "#cbd5e1",
    fontSize: 11,
    marginBottom: 4,
    textTransform: "uppercase",
  },
  bubbleText: { color: "#f8fafc" },
  attachMeta: { color: "#cbd5e1", fontSize: 12, marginTop: 4 },
  workPanel: {
    backgroundColor: "#1e293b",
    borderRadius: 8,
    padding: 8,
    marginBottom: 8,
    maxHeight: 120,
  },
  workTitle: { color: "#94a3b8", fontSize: 12, marginBottom: 4 },
  workItem: { color: "#e2e8f0", fontSize: 11 },
  approvalBox: {
    backgroundColor: "#422006",
    borderRadius: 8,
    padding: 10,
    marginBottom: 8,
  },
  approvalLabel: {
    color: "#fcd34d",
    fontSize: 11,
    fontWeight: "600",
    marginBottom: 4,
  },
  approvalText: { color: "#fde68a", marginBottom: 8 },
  approvalRow: { flexDirection: "row", gap: 8 },
  approveBtn: {
    flex: 1,
    backgroundColor: "#15803d",
    borderRadius: 6,
    padding: 8,
    alignItems: "center",
  },
  rejectBtn: {
    flex: 1,
    backgroundColor: "#b91c1c",
    borderRadius: 6,
    padding: 8,
    alignItems: "center",
  },
  cancelBtn: { alignItems: "center", marginBottom: 4 },
  steerToggle: { alignItems: "flex-start", marginBottom: 4 },
  steerOn: { color: "#fbbf24", fontWeight: "700" },
  pendingRow: { maxHeight: 140, marginBottom: 4 },
  pendingContent: { gap: 8, paddingVertical: 4 },
  pendingChip: { position: "relative", marginRight: 8 },
  pendingRemove: {
    position: "absolute",
    top: 2,
    right: 2,
    backgroundColor: "#0f172a",
    borderRadius: 10,
    width: 20,
    height: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  pendingRemoveText: { color: "#f87171", fontSize: 12, fontWeight: "700" },
  composer: {
    borderTopWidth: 1,
    borderTopColor: "#334155",
    paddingTop: 8,
  },
  attachRow: { flexDirection: "row", gap: 8, marginBottom: 8 },
  attachBtn: {
    backgroundColor: "#334155",
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  attachBtnActive: { backgroundColor: "#b91c1c" },
  attachText: { fontSize: 16 },
  input: {
    backgroundColor: "#1e293b",
    color: "#f8fafc",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 8,
  },
  composerInput: { minHeight: 44, maxHeight: 120 },
  primaryBtn: {
    backgroundColor: "#0284c7",
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: "center",
  },
  disabledBtn: { opacity: 0.6 },
  primaryBtnText: { color: "#fff", fontWeight: "600" },
});
