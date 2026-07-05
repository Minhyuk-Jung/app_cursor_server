import { useState } from "react";
import { Image, Linking, Pressable, StyleSheet, Text } from "react-native";
import { IMAGE_RE } from "../lib/markdown-blocks";

export function MarkdownImage({
  url,
  alt,
  itemKey,
}: {
  url: string;
  alt?: string;
  itemKey: string;
}) {
  const [failed, setFailed] = useState(false);
  const canPreview = /^https?:\/\//i.test(url) && !failed;

  if (!canPreview) {
    const label = alt?.trim() ? `🖼 ${alt}` : "🖼 이미지";
    return (
      <Text
        key={itemKey}
        style={styles.imageLink}
        onPress={() => void Linking.openURL(url)}
      >
        {label}
      </Text>
    );
  }

  return (
    <Pressable key={itemKey} onPress={() => void Linking.openURL(url)}>
      <Image
        source={{ uri: url }}
        style={styles.image}
        accessibilityLabel={alt || "markdown image"}
        onError={() => setFailed(true)}
      />
    </Pressable>
  );
}

export function matchMarkdownImage(part: string) {
  return part.match(IMAGE_RE);
}

const styles = StyleSheet.create({
  imageLink: { color: "#a78bfa", textDecorationLine: "underline" },
  image: {
    width: 240,
    height: 140,
    borderRadius: 6,
    marginVertical: 6,
    backgroundColor: "#1e293b",
  },
});
