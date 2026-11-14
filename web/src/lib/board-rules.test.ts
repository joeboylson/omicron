import { describe, expect, test } from "vitest";
import { inOrder, placeAt } from "./board-rules";

const card = (id: string, position: number, number: number) => ({ id, position, number });

describe("placeAt", () => {
  test("between untied cards: halfway, nothing else moves", () => {
    expect(placeAt([card("a", 1, 1), card("b", 2, 2)], 1)).toEqual({ position: 1.5, renumber: [] });
  });

  test("top, bottom and an empty column", () => {
    expect(placeAt([card("a", 1, 1)], 0).position).toBe(0);
    expect(placeAt([card("a", 1, 1)], 1).position).toBe(2);
    expect(placeAt([], 0)).toEqual({ position: 0, renumber: [] });
  });

  test("between tied cards: the column is numbered first, so it lands where it was dropped (#118)", () => {
    // To do after organizing a filtered column: Milk 1, Bread 1, Butter 2.
    // Eggs is dropped between Milk and Bread.
    const others = [card("milk", 1, 1), card("bread", 1, 2), card("butter", 2, 4)];
    const { position, renumber } = placeAt(others, 1);
    // Numbered 0, 1, 2: only Milk's position changes (Butter is 2 already).
    expect(renumber).toEqual([{ id: "milk", position: 0 }]);
    // Milk 0, Bread 1: Eggs between them.
    expect(position).toBe(0.5);
    const after = inOrder([card("milk", 0, 1), card("bread", 1, 2), card("butter", 2, 4), card("eggs", position, 3)]);
    expect(after.map((c) => c.id)).toEqual(["milk", "eggs", "bread", "butter"]);
  });

  test("ties anywhere in the column are numbered away, even away from the drop", () => {
    const { renumber } = placeAt([card("a", 0, 1), card("b", 5, 2), card("c", 5, 3)], 0);
    expect(renumber.map((r) => r.id)).toEqual(["b", "c"]);
  });
});
