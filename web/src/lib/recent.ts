// Tasks opened lately, in this browser: what ⌘K suggests before you type
// (#234). A convenience only: it may not be kept, which is fine.

export type RecentTask = { projectId: string; project: string; number: number; title: string };
const KEY = "omicron.recentTasks";

export function recentTasks(): RecentTask[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(v) ? v.slice(0, 5) : [];
  } catch {
    return [];
  }
}

export function rememberTask(t: RecentTask) {
  try {
    const rest = recentTasks().filter((r) => !(r.projectId === t.projectId && r.number === t.number));
    localStorage.setItem(KEY, JSON.stringify([t, ...rest].slice(0, 5)));
  } catch {
    // Not kept: nothing lost.
  }
}

/** Open the ⌘K menu from a button (the phone's top bar has one). */
export function openCommands() {
  window.dispatchEvent(new Event("omicron:commands"));
}
