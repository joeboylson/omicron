import { expect, it } from "vitest";
import { keyParts } from "./Shortcuts";

it("splits a shortcut into one box per key, with joining words as text", () => {
  expect(keyParts("⌘K or Ctrl-K")).toEqual([
    { text: "⌘K", key: true },
    { text: "or", key: false },
    { text: "Ctrl-K", key: true },
  ]);
  expect(keyParts("Shift+Enter (adding a task)").at(-1)).toEqual({ text: "(adding a task)", key: false });
  expect(keyParts("⌘, or Ctrl-,").filter((p) => p.key).map((p) => p.text)).toEqual(["⌘,", "Ctrl-,"]);
  expect(keyParts("Arrows, or j k h l").filter((p) => p.key).map((p) => p.text)).toEqual(["Arrows", "j", "k", "h", "l"]);
});
