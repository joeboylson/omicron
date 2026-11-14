import { describe, expect, test } from "vitest";
import { errorWords, OFFLINE_WORDS, SOMETHING_WRONG } from "./omicron";

describe("errorWords", () => {
  test("the connection, in plain words", () => {
    expect(errorWords(new TypeError("Failed to fetch"))).toBe(OFFLINE_WORDS);
  });
  test("a slip in the page's code isn't shown as code (#197)", () => {
    expect(errorWords(new TypeError("Cannot read properties of undefined (reading 'id')"))).toBe(SOMETHING_WRONG);
    expect(errorWords(new ReferenceError("x is not defined"))).toBe(SOMETHING_WRONG);
  });
  test("what the database said stays (already in plain words)", () => {
    expect(errorWords(new Error("There's already one with that name."))).toBe("There's already one with that name.");
  });
});
