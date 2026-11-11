// Colors for statuses and labels: Apple's system colors by name. The CSS
// variables (index.css) hold the light and dark shades.

export const COLORS = ["red", "orange", "yellow", "green", "teal", "blue", "indigo", "purple", "pink", "brown", "gray"] as const;
export type Color = (typeof COLORS)[number];

/** The CSS color for a name. */
export const sys = (c: Color) => `var(--sys-${c})`;

/** A light wash of a color, for a badge's background. */
export const tint = (c: Color, percent = 18) => `color-mix(in srgb, var(--sys-${c}) ${percent}%, transparent)`;

/** A status's color: its own, or green for the Done status and gray otherwise. */
export const statusColor = (s: { color: string | null; is_done: boolean }): Color =>
  (s.color as Color | null) ?? (s.is_done ? "green" : "gray");

/** Upper-case first letter, for showing a color's name. */
export const colorName = (c: Color) => c[0].toUpperCase() + c.slice(1);
