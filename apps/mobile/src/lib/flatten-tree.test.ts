import { describe, expect, it } from "vitest";
import type { TreeNode } from "@app/shared";
import { flattenTree, initialExpandedDirs, toggleExpandedDir } from "./flatten-tree";

const sample: TreeNode[] = [
  {
    name: "src",
    path: "src",
    type: "dir",
    children: [
      { name: "a.ts", path: "src/a.ts", type: "file" },
      {
        name: "lib",
        path: "src/lib",
        type: "dir",
        children: [{ name: "b.ts", path: "src/lib/b.ts", type: "file" }],
      },
    ],
  },
  { name: "README.md", path: "README.md", type: "file" },
];

describe("flattenTree", () => {
  it("flattens only expanded directories", () => {
    const expanded = new Set(["src"]);
    const rows = flattenTree(sample, expanded);
    expect(rows.map((r) => r.path)).toEqual([
      "src",
      "src/a.ts",
      "src/lib",
      "README.md",
    ]);
  });

  it("includes nested files when lib expanded", () => {
    const expanded = new Set(["src", "src/lib"]);
    const rows = flattenTree(sample, expanded);
    expect(rows.some((r) => r.path === "src/lib/b.ts")).toBe(true);
  });

  it("toggleExpandedDir adds and removes paths", () => {
    let set = new Set<string>();
    set = toggleExpandedDir(set, "src");
    expect(set.has("src")).toBe(true);
    set = toggleExpandedDir(set, "src");
    expect(set.has("src")).toBe(false);
  });

  it("initialExpandedDirs opens depth 0-1 dirs", () => {
    const expanded = initialExpandedDirs(sample);
    expect(expanded.has("src")).toBe(true);
    expect(expanded.has("src/lib")).toBe(true);
  });
});
