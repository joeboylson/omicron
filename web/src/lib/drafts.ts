// A comment being written, kept per task in this browser, so closing the
// sheet (or reloading) doesn't lose it (#200). Gone once it's sent.

const key = (taskId: string) => `omicron.draft.${taskId}`;

export function loadDraft(taskId: string): string {
  try {
    return localStorage.getItem(key(taskId)) ?? "";
  } catch {
    return "";
  }
}

export function saveDraft(taskId: string, text: string) {
  try {
    if (text.trim()) localStorage.setItem(key(taskId), text);
    else localStorage.removeItem(key(taskId));
  } catch {
    // Private browsing and the like: not kept.
  }
}
