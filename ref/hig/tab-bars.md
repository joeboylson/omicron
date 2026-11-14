# Tab Bars
Source: https://developer.apple.com/design/human-interface-guidelines/tab-bars

## In one line

A tab bar moves between the app's top-level sections (never runs actions), stays visible, keeps every tab enabled, and labels each with an icon and a single word.

## Rules

1. Use a tab bar for navigation, not actions; for controls that act on the current view, use a toolbar. [Best practices]
2. Keep the tab bar visible as people move between sections; only a temporary modal view may cover it. [Best practices]
3. Use only as many tabs as needed, since fewer tabs are easier; for a complex structure, consider a sidebar or a tab bar that adapts into one. [Best practices]
4. Avoid overflow: when tabs don't fit, the last becomes a More tab, which hides content, so limit when that can happen. [Best practices]
5. Never disable or hide a tab, even when its content is unavailable; if a section is empty, explain why. [Best practices]
6. Give each tab a label, a single word where possible, beneath or beside its icon. [Best practices]
7. Use familiar, scalable icons (SF Symbols), preferring filled ones; icons sit above labels in compact views and beside them in regular views. [Best practices]
8. Use a badge (a red oval with white text, a number or an exclamation point) only for critical new or updated information in a section. [Best practices]
9. Don't color tab labels like a colorful content background; prefer a monochrome tab bar or a clearly different accent color. [Best practices]
10. On iPhone, the tab bar floats at the bottom of the screen; it can include a dedicated search tab at the trailing end. [iOS]
11. On iPad, the tab bar sits near the top and can offer a button to turn it into a sidebar for apps with more sections. [iPadOS]
12. If people can customize tabs, keep the default list to five or fewer. [iPadOS]

## How it applies to a web app on iPhone and Mac

- On the phone, the main sections (like Board, Sessions, Machines) are a bottom tab bar of at most five tabs, each an icon over a one-word label, fixed at the bottom and clear of the home indicator (safe-area inset).
- On Mac widths, the same sections live in the sidebar instead (see `sidebars.md`); don't show both.
- Tabs only navigate; "New Task" and other actions live in the toolbar, not the tab bar.
- Every tab stays tappable; an empty section shows a short empty state saying why.
- A count badge on a tab (or sidebar item) only for things that need attention, like tasks Waiting on Joe; not for totals.
- The tab bar stays visible on every page except while a sheet or dialog covers it.
