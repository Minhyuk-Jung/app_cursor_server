import { describe, expect, it } from "vitest";
import {
  projectFilePath,
  projectGitPath,
  projectSearchPath,
  projectTreePath,
} from "./file-api-paths.js";

describe("file-api-paths", () => {
  it("builds tree and file URLs", () => {
    expect(projectTreePath("http://host", "p1")).toBe(
      "http://host/api/v1/projects/p1/tree",
    );
    expect(projectFilePath("http://host/", "p1")).toBe(
      "http://host/api/v1/projects/p1/file",
    );
  });

  it("builds search URL with query", () => {
    const url = projectSearchPath("http://host", "p1", "hello world");
    expect(url).toContain("/search?");
    expect(url).toContain("q=hello");
  });

  it("builds git status URL", () => {
    expect(projectGitPath("http://localhost:3000/", "p1")).toBe(
      "http://localhost:3000/api/v1/projects/p1/git",
    );
  });
});
