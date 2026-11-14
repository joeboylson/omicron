// Unit tests for the page's plain logic: run with `npm test` (vitest).
import { describe, expect, test } from "vitest";
import { positionBetween } from "./data";

describe("positionBetween", () => {
  test("between two cards: halfway", () => {
    expect(positionBetween(1, 2)).toBe(1.5);
  });
  test("at the top or bottom: one past the end", () => {
    expect(positionBetween(undefined, 4)).toBe(3);
    expect(positionBetween(4, undefined)).toBe(5);
  });
  test("an empty column: 0", () => {
    expect(positionBetween(undefined, undefined)).toBe(0);
  });
});
