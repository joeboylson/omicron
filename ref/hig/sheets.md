# Sheets
Source: https://developer.apple.com/design/human-interface-guidelines/sheets

## In one line

A sheet is a short, focused task over the current view; one at a time, with Cancel on the leading side and Done on the trailing side, and on iPhone it can be swiped down to close.

## Rules

1. Use a sheet for a scoped task closely related to the current context, such as supplying information to finish an action. [Sheets]
2. A Cancel (or Close) button dismisses without saving; a Done button dismisses after finishing or saving; a Back button goes to a previous step and never dismisses. [Anatomy]
3. For complex or long tasks, use something other than a sheet: a full-screen view on iPhone and iPad, a new window or full screen on Mac. [Best practices]
4. Show only one sheet at a time from the main interface; if something in a sheet opens another sheet, close the first one before showing the new one. [Best practices]
5. For supplementary tools that affect the main view while people keep working in it, use a nonmodal view (a nonmodal sheet on iPhone and iPad, a panel on Mac). [Best practices]
6. Always pair a Done button with a Cancel button (or a Back button in a multi-step flow); never show Cancel, Done and Back together. [Best practices]
7. On iPhone and iPad, in a single-view sheet Cancel goes on the leading edge of the top toolbar and Done on the trailing edge. [iOS, iPadOS]
8. A resizable sheet rests at detents: large (full height) and medium (about half). Consider medium on iPhone for progressive disclosure; skip it when content needs full height, like a compose sheet. [iOS, iPadOS]
9. Include a grabber (the small bar at the top) on a resizable sheet; people can drag it, tap it to cycle heights, and use it with VoiceOver. [iOS, iPadOS]
10. Support swiping down to dismiss; if there are unsaved changes, confirm with an action sheet first. [iOS, iPadOS]
11. On iPad, prefer the page or form sheet styles, centered over a dimmed background. [iOS, iPadOS]
12. On Mac, a sheet is a rounded card floating over its dimmed parent window, presented at a sensible default size (resizable if people need more room). [macOS]
13. On Mac, let people use the app's other windows while a sheet is open; use a panel instead if people repeatedly enter input and watch results (like find and replace). [macOS]

## How it applies to a web app on iPhone and Mac

- shadcn `Dialog` is the sheet: on the phone it's the bottom sheet from `components/base/` (slides up, grabber, swipe down to close); on Mac it's a centered card over a dimmed page.
- Header layout: Cancel at the leading (left) end, the title in the middle, Done or Save at the trailing (right) end; or a footer with the primary button on the right. Never Cancel, Done and Back all at once.
- Swiping down or clicking the backdrop with unsaved edits asks first (an `AlertDialog`: keep editing or discard).
- Never open a dialog from inside a dialog; close the first or move the step inside the same dialog.
- Big jobs (editing a whole task with its history, long forms) get their own page instead of a sheet.
- On the phone, start a sheet at half height when its first few items are what people usually need; compose-type sheets open at full height.
