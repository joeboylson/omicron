import { describe, expect, it } from "vitest";
import { keyboardHeight } from "./keyboard";

describe("keyboardHeight", () => {
  it("is what the keyboard covers at the bottom", () => {
    expect(keyboardHeight(844, 508, 0)).toBe(336);
    // Scrolled up a little while it's open: the covered part is still below.
    expect(keyboardHeight(844, 508, 40)).toBe(296);
  });
  it("is 0 with no keyboard, or only a toolbar's worth", () => {
    expect(keyboardHeight(844, 844, 0)).toBe(0);
    expect(keyboardHeight(844, 790, 0)).toBe(0);
  });
});
