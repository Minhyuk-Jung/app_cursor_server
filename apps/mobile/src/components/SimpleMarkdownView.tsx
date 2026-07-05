import {
  extractFootnoteDefinitions,
  hasFootnoteDefinition,
  parseOrderedListLine,
  parseTaskListLine,
  sanitizeMarkdownLinkHref,
} from "@app/shared";
import type { ReactNode } from "react";
import { useRef } from "react";
import {
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  BOLD_RE,
  INLINE_RE,
  isBlockquoteLine,
  isHorizontalRule,
  ITALIC_RE,
  LINK_RE,
  parseMarkdownTable,
  splitMarkdownBlocks,
  STRIKETHROUGH_TOKEN_RE,
  stripBlockquote,
  UNDERSCORE_ITALIC_RE,
} from "../lib/markdown-blocks";
import { clampFootnoteScrollY, footnoteRefLabel, footnoteRefTestId, isFootnoteRefActive } from "../lib/markdown-footnote";
import {
  isAutolinkToken,
  normalizeAutolinkUrl,
  splitAutolinkTokens,
} from "../lib/markdown-inline";
import { MarkdownImage, matchMarkdownImage } from "./MarkdownImage";

function renderPlainWithAutolinks(text: string, keyPrefix: string) {
  if (!text) return text;
  const chunks = splitAutolinkTokens(text);
  return chunks.map((chunk, i) => {
    const key = `${keyPrefix}-url-${i}`;
    if (isAutolinkToken(chunk)) {
      const url = normalizeAutolinkUrl(chunk);
      const safe = sanitizeMarkdownLinkHref(url);
      if (!safe) {
        return chunk;
      }
      return (
        <Text
          key={key}
          style={styles.link}
          onPress={() => void Linking.openURL(safe)}
        >
          {chunk}
        </Text>
      );
    }
    return chunk;
  });
}

function renderInline(
  text: string,
  keyPrefix: string,
  footnotes: Record<string, string> = {},
  onFootnotePress?: (id: string) => void,
) {
  const parts = text.split(INLINE_RE);
  return parts.map((part, i) => {
    const key = `${keyPrefix}-${i}`;
    const footnoteMatch = part.match(/^\[\^([^\]]+)\]$/);
    if (footnoteMatch) {
      const id = footnoteMatch[1]!;
      if (isFootnoteRefActive(id, footnotes)) {
        return (
          <Pressable
            key={key}
            onPress={() => onFootnotePress?.(id)}
            accessibilityRole="link"
            accessibilityLabel={`각주 ${id}`}
            testID={footnoteRefTestId(id)}
          >
            <Text style={styles.footnoteRef}>{footnoteRefLabel(id)}</Text>
          </Pressable>
        );
      }
      return (
        <Text key={key} style={styles.body}>
          {part}
        </Text>
      );
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <Text key={key} style={styles.code}>
          {part.slice(1, -1)}
        </Text>
      );
    }
    const boldMatch = part.match(BOLD_RE);
    if (boldMatch) {
      return (
        <Text key={key} style={styles.bold}>
          {renderInline(boldMatch[1]!, `${key}-b`, footnotes, onFootnotePress)}
        </Text>
      );
    }
    const strikeMatch = part.match(STRIKETHROUGH_TOKEN_RE);
    if (strikeMatch) {
      return (
        <Text key={key} style={styles.strike}>
          {renderInline(strikeMatch[1]!, `${key}-s`, footnotes, onFootnotePress)}
        </Text>
      );
    }
    const italicMatch = part.match(ITALIC_RE);
    if (italicMatch) {
      return (
        <Text key={key} style={styles.italic}>
          {renderInline(italicMatch[1]!, `${key}-i`, footnotes, onFootnotePress)}
        </Text>
      );
    }
    const underscoreItalic = part.match(UNDERSCORE_ITALIC_RE);
    if (underscoreItalic) {
      return (
        <Text key={key} style={styles.italic}>
          {renderInline(underscoreItalic[1]!, `${key}-u`, footnotes, onFootnotePress)}
        </Text>
      );
    }
    const imageMatch = matchMarkdownImage(part);
    if (imageMatch) {
      const [, alt, url] = imageMatch;
      const safe = sanitizeMarkdownLinkHref(url!);
      if (!safe) {
        return part;
      }
      return (
        <MarkdownImage key={key} itemKey={key} url={safe} alt={alt} />
      );
    }
    const linkMatch = part.match(LINK_RE);
    if (linkMatch) {
      const [, label, url] = linkMatch;
      const safe = sanitizeMarkdownLinkHref(url!);
      if (!safe) {
        return renderInline(label!, `${key}-lbl`, footnotes, onFootnotePress);
      }
      return (
        <Text
          key={key}
          style={styles.link}
          onPress={() => void Linking.openURL(safe)}
        >
          {renderInline(label!, `${key}-lbl`, footnotes, onFootnotePress)}
        </Text>
      );
    }
    return renderPlainWithAutolinks(part, key);
  });
}

function renderTable(
  table: { headers: string[]; rows: string[][] },
  key: string,
  footnotes: Record<string, string>,
  onFootnotePress?: (id: string) => void,
) {
  return (
    <ScrollView key={key} horizontal style={styles.tableScroll}>
      <View style={styles.table}>
        <View style={[styles.tableRow, styles.tableHeaderRow]}>
          {table.headers.map((cell, i) => (
            <Text key={`${key}-h-${i}`} style={[styles.tableCell, styles.tableHeader]}>
              {renderInline(cell, `${key}-h-${i}`, footnotes, onFootnotePress)}
            </Text>
          ))}
        </View>
        {table.rows.map((row, rowIndex) => (
          <View key={`${key}-r-${rowIndex}`} style={styles.tableRow}>
            {row.map((cell, colIndex) => (
              <Text key={`${key}-c-${rowIndex}-${colIndex}`} style={styles.tableCell}>
                {renderInline(cell, `${key}-c-${rowIndex}-${colIndex}`, footnotes, onFootnotePress)}
              </Text>
            ))}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

function renderTextBlock(
  content: string,
  blockKey: string,
  footnotes: Record<string, string>,
  onFootnotePress?: (id: string) => void,
) {
  const lines = content.split("\n");
  const nodes: ReactNode[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    const key = `${blockKey}-${index}`;
    const tableParsed = parseMarkdownTable(lines, index);
    if (tableParsed) {
      nodes.push(renderTable(tableParsed.table, key, footnotes, onFootnotePress));
      index = tableParsed.nextIndex;
      continue;
    }
    if (hasFootnoteDefinition(line)) {
      index += 1;
      continue;
    }
    if (isHorizontalRule(line)) {
      nodes.push(<View key={key} style={styles.rule} />);
    } else if (isBlockquoteLine(line)) {
      nodes.push(
        <View key={key} style={styles.blockquote}>
          <Text style={styles.body}>
            {renderInline(stripBlockquote(line), key, footnotes, onFootnotePress)}
          </Text>
        </View>,
      );
    } else if (line.startsWith("### ")) {
      nodes.push(
        <Text key={key} style={styles.h3}>
          {renderInline(line.slice(4), key, footnotes, onFootnotePress)}
        </Text>,
      );
    } else if (line.startsWith("## ")) {
      nodes.push(
        <Text key={key} style={styles.h2}>
          {renderInline(line.slice(3), key, footnotes, onFootnotePress)}
        </Text>,
      );
    } else if (line.startsWith("# ")) {
      nodes.push(
        <Text key={key} style={styles.h1}>
          {renderInline(line.slice(2), key, footnotes, onFootnotePress)}
        </Text>,
      );
    } else {
      const task = parseTaskListLine(line);
      if (task) {
        nodes.push(
          <View key={key} style={styles.taskRow}>
            <Text style={styles.taskMark}>{task.checked ? "☑" : "☐"}</Text>
            <Text style={[styles.body, task.checked && styles.taskDone]}>
              {renderInline(task.text, key, footnotes, onFootnotePress)}
            </Text>
          </View>,
        );
      } else {
        const ordered = parseOrderedListLine(line);
        if (ordered) {
          nodes.push(
            <View key={key} style={styles.orderedRow}>
              <Text style={styles.orderedIndex}>{ordered.index}.</Text>
              <Text style={styles.body}>{renderInline(ordered.text, key, footnotes, onFootnotePress)}</Text>
            </View>,
          );
        } else if (line.startsWith("- ") || line.startsWith("* ")) {
          nodes.push(
            <View key={key} style={styles.listRow}>
              <Text style={styles.bullet}>•</Text>
              <Text style={styles.body}>{renderInline(line.slice(2), key, footnotes, onFootnotePress)}</Text>
            </View>,
          );
        } else if (!line.trim()) {
          nodes.push(<View key={key} style={styles.spacer} />);
        } else {
          nodes.push(
            <Text key={key} style={styles.body}>
              {renderInline(line, key, footnotes, onFootnotePress)}
            </Text>,
          );
        }
      }
    }
    index += 1;
  }
  return nodes;
}

export function SimpleMarkdownView({ content }: { content: string }) {
  const scrollRef = useRef<ScrollView>(null);
  const contentRef = useRef<View>(null);
  const footnoteViewRefs = useRef<Record<string, View | null>>({});
  const { body, footnotes } = extractFootnoteDefinitions(content);
  const blocks = splitMarkdownBlocks(body);

  const scrollToFootnote = (id: string) => {
    const target = footnoteViewRefs.current[id];
    const container = contentRef.current;
    if (!target || !container) return;
    target.measureLayout(
      container,
      (_x, y) => {
        scrollRef.current?.scrollTo({
          y: clampFootnoteScrollY(y),
          animated: true,
        });
      },
      () => {},
    );
  };

  return (
    <ScrollView ref={scrollRef} style={styles.scroll} testID="markdown-preview">
      <View ref={contentRef} collapsable={false}>
        {blocks.map((block, index) => {
          const key = `block-${index}`;
          if (block.kind === "code") {
            return (
              <View key={key} style={styles.codeBlock}>
                {block.lang ? (
                  <Text style={styles.codeLang}>{block.lang}</Text>
                ) : null}
                <ScrollView horizontal>
                  <Text style={styles.codeBlockText}>{block.content}</Text>
                </ScrollView>
              </View>
            );
          }
          return (
            <View key={key}>
              {renderTextBlock(block.content, key, footnotes, scrollToFootnote)}
            </View>
          );
        })}
        {Object.entries(footnotes).map(([id, note]) => (
          <View
            key={`fn-${id}`}
            ref={(node) => {
              footnoteViewRefs.current[id] = node;
            }}
            style={styles.footnoteItem}
            testID={`footnote-${id}`}
          >
            <Text style={styles.footnoteLabel}>{id}. </Text>
            <Text style={styles.body}>
              {renderInline(note, `fn-${id}`, footnotes, scrollToFootnote)}
            </Text>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  h1: {
    color: "#f8fafc",
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 6,
  },
  h2: {
    color: "#f8fafc",
    fontSize: 16,
    fontWeight: "700",
    marginBottom: 4,
  },
  h3: {
    color: "#e2e8f0",
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 4,
  },
  body: { color: "#cbd5e1", fontSize: 13, marginBottom: 4, lineHeight: 20 },
  bold: { fontWeight: "700", color: "#f8fafc" },
  italic: { fontStyle: "italic", color: "#e2e8f0" },
  strike: {
    textDecorationLine: "line-through",
    color: "#94a3b8",
  },
  code: {
    fontFamily: "monospace",
    backgroundColor: "#334155",
    color: "#fde68a",
    fontSize: 12,
  },
  link: { color: "#38bdf8", textDecorationLine: "underline" },
  blockquote: {
    borderLeftWidth: 3,
    borderLeftColor: "#475569",
    paddingLeft: 10,
    marginBottom: 8,
  },
  rule: {
    height: 1,
    backgroundColor: "#334155",
    marginVertical: 10,
  },
  codeBlock: {
    backgroundColor: "#1e293b",
    borderRadius: 6,
    padding: 10,
    marginBottom: 8,
  },
  codeLang: {
    color: "#94a3b8",
    fontSize: 11,
    marginBottom: 4,
    textTransform: "uppercase",
  },
  codeBlockText: {
    fontFamily: "monospace",
    color: "#fde68a",
    fontSize: 12,
    lineHeight: 18,
  },
  tableScroll: { marginBottom: 8 },
  table: {
    borderWidth: 1,
    borderColor: "#334155",
    borderRadius: 6,
    overflow: "hidden",
  },
  tableRow: { flexDirection: "row" },
  tableHeaderRow: { backgroundColor: "#1e293b" },
  tableCell: {
    minWidth: 72,
    paddingHorizontal: 8,
    paddingVertical: 6,
    color: "#cbd5e1",
    fontSize: 12,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: "#334155",
  },
  tableHeader: { color: "#f8fafc", fontWeight: "700" },
  listRow: { flexDirection: "row", gap: 6, marginBottom: 4 },
  taskRow: { flexDirection: "row", gap: 6, marginBottom: 4, paddingLeft: 2 },
  footnoteRef: {
    color: "#38bdf8",
    fontSize: 10,
    lineHeight: 12,
    fontWeight: "700",
    textAlignVertical: "top",
  },
  footnoteItem: { flexDirection: "row", gap: 4, marginTop: 4, paddingLeft: 4 },
  footnoteLabel: { color: "#94a3b8", fontSize: 12, fontWeight: "700" },
  orderedRow: { flexDirection: "row", gap: 6, marginBottom: 4, paddingLeft: 2 },
  orderedIndex: { color: "#94a3b8", fontSize: 13, minWidth: 18 },
  taskMark: { color: "#94a3b8", fontSize: 13, width: 16 },
  taskDone: { textDecorationLine: "line-through", color: "#64748b" },
  bullet: { color: "#94a3b8", fontSize: 13 },
  spacer: { height: 8 },
});
