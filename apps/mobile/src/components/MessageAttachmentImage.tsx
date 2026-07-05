import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { fetchAttachmentFileUri } from "../api/client";
import type { MobileSettings } from "../config";

export function MessageAttachmentImage({
  settings,
  projectId,
  attachmentRef,
  mime,
}: {
  settings: MobileSettings;
  projectId: string;
  attachmentRef: string;
  mime?: string;
}) {
  const [uri, setUri] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setUri(null);
    setFailed(false);
    void fetchAttachmentFileUri(settings, projectId, attachmentRef)
      .then((localUri) => {
        if (!cancelled) setUri(localUri);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [settings, projectId, attachmentRef]);

  if (failed) {
    return (
      <Text style={styles.fallback}>
        📎 {mime ?? "attachment"} ({attachmentRef.slice(0, 8)}…)
      </Text>
    );
  }

  if (!uri) {
    return (
      <View style={styles.loaderWrap}>
        <ActivityIndicator size="small" color="#94a3b8" />
      </View>
    );
  }

  return (
    <Image
      source={{ uri }}
      style={styles.image}
      resizeMode="cover"
      accessibilityLabel="첨부 이미지"
    />
  );
}

const styles = StyleSheet.create({
  image: {
    width: 160,
    height: 120,
    borderRadius: 6,
    marginTop: 6,
    backgroundColor: "#1e293b",
  },
  loaderWrap: {
    width: 160,
    height: 48,
    justifyContent: "center",
    marginTop: 6,
  },
  fallback: {
    color: "#cbd5e1",
    fontSize: 12,
    marginTop: 4,
  },
});
