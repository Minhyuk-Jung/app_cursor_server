import { describe, expect, it } from "vitest";
import {
  hasInboxGitEntry,
  pickInboxGitDuplicateIds,
} from "./maestro-seed-lib";

describe("maestro-seed-lib", () => {
  it("keeps first Maestro Git inbox and returns duplicate ids", () => {
    const ids = pickInboxGitDuplicateIds(
      [
        { id: "a", title: "Maestro Git" },
        { id: "b", title: "Maestro Git" },
        { id: "c", title: "Other" },
      ],
      "Maestro Git",
    );
    expect(ids).toEqual(["b"]);
  });

  it("detects existing Maestro Git inbox", () => {
    expect(
      hasInboxGitEntry([{ title: "x" }, { title: "Maestro Git" }], "Maestro Git"),
    ).toBe(true);
    expect(hasInboxGitEntry([{ title: "x" }], "Maestro Git")).toBe(false);
  });
});
