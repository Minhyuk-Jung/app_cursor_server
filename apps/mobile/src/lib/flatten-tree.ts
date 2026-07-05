import type { TreeNode } from "@app/shared";

export interface FlatTreeRow {
  key: string;
  path: string;
  name: string;
  type: "dir" | "file";
  depth: number;
  hasChildren: boolean;
  expanded: boolean;
}

/** 펼친 디렉터리만 포함 — FlatList 가상화용 (UR-02 11차) */
export function flattenTree(
  nodes: TreeNode[],
  expandedDirs: ReadonlySet<string>,
  depth = 0,
): FlatTreeRow[] {
  const rows: FlatTreeRow[] = [];
  for (const node of nodes) {
    const hasChildren =
      node.type === "dir" && Boolean(node.children && node.children.length > 0);
    const expanded = node.type === "dir" && expandedDirs.has(node.path);
    rows.push({
      key: node.path || node.name,
      path: node.path,
      name: node.name,
      type: node.type,
      depth,
      hasChildren,
      expanded,
    });
    if (expanded && node.children?.length) {
      rows.push(...flattenTree(node.children, expandedDirs, depth + 1));
    }
  }
  return rows;
}

export function toggleExpandedDir(
  expanded: Set<string>,
  dirPath: string,
): Set<string> {
  const next = new Set(expanded);
  if (next.has(dirPath)) next.delete(dirPath);
  else next.add(dirPath);
  return next;
}

/** 초기 펼침: depth 0~1 디렉터리 */
export function initialExpandedDirs(
  nodes: TreeNode[],
  depth = 0,
  acc = new Set<string>(),
): Set<string> {
  for (const node of nodes) {
    if (node.type === "dir" && depth < 2) {
      acc.add(node.path);
      if (node.children) initialExpandedDirs(node.children, depth + 1, acc);
    }
  }
  return acc;
}
