# Alerts
Source: https://developer.apple.com/design/human-interface-guidelines/alerts

## In one line

An alert interrupts with critical information that needs action now; use it rarely, give it a specific title and specific button names, and put Cancel on the leading side.

## Rules

1. Use alerts sparingly, each with only essential information and useful actions. [Best practices]
2. Don't use an alert just to inform; show non-actionable information in context instead (like Mail's offline indicator). [Best practices]
3. Don't alert for common actions that can be undone, even destructive ones (like deleting an email); do alert for an uncommon destructive action that can't be undone. [Best practices]
4. Don't show an alert when the app starts; for a startup problem like no network, show cached or placeholder data and a quiet label describing the problem. [Best practices]
5. An alert has a title, optional informative text and up to three buttons; it can include a text field only when input is needed to resolve the situation (like a password). [Content]
6. Write direct, neutral, approachable copy that neither hides nor overstates how serious things are. [Content]
7. The title says specifically what happened, where and why, in no more than two lines; never just "Error" or an error number. A full-sentence title uses sentence-style capitalization and ending punctuation; a fragment uses title-style capitalization and no punctuation. [Content]
8. Add informative text only if it adds value: short, complete sentences, sentence-style capitalization. Don't explain the buttons. [Content]
9. Button titles are one or two words describing the result, preferably verbs tied to the alert text ("View All", "Reply", "Ignore"), title-style capitalization, no ending punctuation. [Buttons]
10. Use "OK" only in purely informational alerts, and never "Yes" or "No"; for actions use a specific title like "Erase", "Convert", "Clear" or "Delete". [Buttons]
11. The most likely button goes on the trailing side of a row (or the top of a stack), and the default button always goes there; Cancel goes on the leading side of a row (or the bottom of a stack). [Buttons]
12. Use the destructive style only for a destructive action people didn't deliberately choose; when they chose it (like Empty Trash), the confirm button is not styled destructive. [Buttons]
13. Any alert with a destructive action has a button titled "Cancel", which is never the default button; to make people read, set no default button; a single default button is "Done", not "Cancel". [Buttons]
14. Let people cancel with Escape (or Command-Period) as well as the Cancel button. [Buttons]
15. On iPhone and iPad, use an action sheet, not an alert, for choices related to an action people chose; and keep alerts short enough not to scroll. [iOS, iPadOS]
16. On Mac, use the caution symbol sparingly, only when extra attention is really needed, such as possible unexpected data loss. [macOS]

## How it applies to a web app on iPhone and Mac

- shadcn `AlertDialog` is the alert; use it only for actions that can't be undone (like deleting a Project), never for routine deletes that have Undo.
- Footer order on Mac and wide screens: Cancel on the left, the action on the right; stacked on the phone, the action on top and Cancel at the bottom.
- The action button names the action ("Delete Project", "Discard"), never "OK" or "Yes"; Escape always cancels.
- Titles are specific ("Delete “Lumen”?"); a sentence of body text only when it adds something, such as what can't be recovered.
- Failures that need no decision (offline, a failed sync) show as an inline banner or toast in context, not an alert; and nothing pops up on page load.
