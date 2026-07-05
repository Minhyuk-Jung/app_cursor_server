import { Pressable, StyleSheet, Text, View } from "react-native";

export type ProjectTab = "sessions" | "files" | "git" | "terminal" | "diff";

export function ProjectNavBar({
  active,
  onSessions,
  onFiles,
  onGit,
  onTerminal,
  onDiff,
}: {
  active: ProjectTab;
  onSessions: () => void;
  onFiles: () => void;
  onGit: () => void;
  onTerminal: () => void;
  onDiff: () => void;
}) {
  return (
    <View style={styles.row}>
      <Pressable
        style={[styles.tab, active === "sessions" && styles.active]}
        onPress={onSessions}
        testID="project-nav-sessions"
      >
        <Text style={styles.text}>세션</Text>
      </Pressable>
      <Pressable
        style={[styles.tab, active === "files" && styles.active]}
        onPress={onFiles}
        testID="project-nav-files"
      >
        <Text style={styles.text}>파일</Text>
      </Pressable>
      <Pressable
        style={[styles.tab, active === "git" && styles.active]}
        onPress={onGit}
        testID="project-nav-git"
      >
        <Text style={styles.text}>Git</Text>
      </Pressable>
      <Pressable
        style={[styles.tab, active === "terminal" && styles.active]}
        onPress={onTerminal}
        testID="project-nav-terminal"
      >
        <Text style={styles.text}>터미널</Text>
      </Pressable>
      <Pressable
        style={[styles.tab, active === "diff" && styles.active]}
        onPress={onDiff}
        testID="project-nav-diff"
      >
        <Text style={styles.text}>리뷰</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    gap: 4,
    marginBottom: 12,
  },
  tab: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 6,
    backgroundColor: "#1e293b",
    alignItems: "center",
  },
  active: {
    backgroundColor: "#0369a1",
  },
  text: {
    color: "#f8fafc",
    fontWeight: "600",
    fontSize: 11,
  },
});
