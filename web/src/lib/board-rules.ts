// The board's rules for where things go, as plain functions (no React, no
// database), so they can be unit tested. The `omicron` command follows the
// same rules (crates/omicron/src/board.rs, place_task).

import { positionBetween } from "./data";

type Placeable = { id: string; position: number; number: number };

/** A column's cards in the order the page shows them: position, then number. */
export function inOrder<T extends Placeable>(cards: T[]): T[] {
  return [...cards].sort((a, b) => a.position - b.position || a.number - b.number);
}

/**
 * Where a card goes when it's put at index `at` among a column's other
 * cards (`others`, in order). Cards with the same position (tied) can't
 * have anything put between them, so if any are tied the column is
 * numbered 0, 1, 2… first, and `renumber` lists the cards whose position
 * that changes.
 */
export function placeAt(others: Placeable[], at: number): { position: number; renumber: { id: string; position: number }[] } {
  const ordered = inOrder(others);
  const tied = ordered.some((c, i) => i > 0 && c.position <= ordered[i - 1].position);
  const renumber: { id: string; position: number }[] = [];
  const positions = ordered.map((c, i) => {
    if (!tied) return c.position;
    if (c.position !== i) renumber.push({ id: c.id, position: i });
    return i;
  });
  return { position: positionBetween(positions[at - 1], positions[at]), renumber };
}
