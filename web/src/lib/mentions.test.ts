import { describe, expect, it } from "vitest";
import { linkMentions, typing } from "./mentions";

describe("typing", () => {
  it("finds an @ or # being typed", () => {
    expect(typing("hi @par", 7)).toEqual({ kind: "@", query: "par", start: 3 });
    expect(typing("#1", 2)).toEqual({ kind: "#", query: "1", start: 0 });
    expect(typing("see #", 5)).toEqual({ kind: "#", query: "", start: 4 });
  });
  it("ignores one in the middle of a word or before the caret's word", () => {
    expect(typing("joe@example", 11)).toBeNull();
    expect(typing("@parser done", 12)).toBeNull();
  });
});

describe("linkMentions", () => {
  it("links tasks that exist and bolds sessions", () => {
    expect(linkMentions("PR #12 for @parser", [12], ["parser"])).toBe("PR [#12](#task-12) for **@parser**");
  });
  it("leaves the rest alone", () => {
    expect(linkMentions("#99 and @nobody and a&#38;b", [12], ["parser"])).toBe("#99 and @nobody and a&#38;b");
  });
});
