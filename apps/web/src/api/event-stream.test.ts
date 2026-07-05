import { describe, expect, it } from "vitest";
import { isNewSeq } from "./event-stream.js";

describe("event-stream seq dedupe", () => {
  it("accepts strictly increasing seq", () => {
    expect(isNewSeq(5, 4)).toBe(true);
    expect(isNewSeq(4, 4)).toBe(false);
    expect(isNewSeq(3, 4)).toBe(false);
  });
});
