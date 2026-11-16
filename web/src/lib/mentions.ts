// @name and #12 in a conversation's messages (#281).

/** The @name or #12 being typed just before the caret, if any. */
export function typing(text: string, caret: number): { kind: "@" | "#"; query: string; start: number } | null {
  const m = /(^|\s)([@#])([\w.-]*)$/.exec(text.slice(0, caret));
  if (!m) return null;
  return { kind: m[2] as "@" | "#", query: m[3], start: caret - m[3].length - 1 };
}
/** A message's text with #12 linked to the task and @name in bold, for Markdown. */
export function linkMentions(text: string, tasks: number[], sessions: string[]): string {
  return text
    .replace(/(^|[^&\w[])#(\d{1,9})\b/g, (all, before, n) => (tasks.includes(Number(n)) ? `${before}[#${n}](#task-${n})` : all))
    .replace(/(^|[^\w`*])@([\w.-]+)/g, (all, before, name) =>
      sessions.some((s) => s.toLowerCase() === name.toLowerCase()) ? `${before}**@${name}**` : all,
    );
}
