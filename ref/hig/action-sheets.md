# Action Sheets
Source: https://developer.apple.com/design/human-interface-guidelines/action-sheets

## In one line

An action sheet offers a few choices about an action people just started (like discarding a draft), with destructive choices on top and Cancel at the bottom.

## Rules

1. Use an action sheet, not an alert, for choices related to an action people deliberately started (like Delete Draft or Save Draft when cancelling a message); alerts are for the unexpected. [Best practices]
2. Use action sheets sparingly, since they interrupt the current task. [Best practices]
3. Keep the title short enough for one line. [Best practices]
4. Add a message only if necessary; usually the title and the context are enough. [Best practices]
5. Include a Cancel button when an action might destroy data, placed at the bottom of the sheet (upper-left corner in watchOS). [Best practices]
6. Make destructive choices prominent: destructive style, placed at the top of the sheet. [Best practices]
7. On iPhone and iPad, use an action sheet, not a menu, for choices that follow an action; people expect a menu only when they choose to open one. [iOS, iPadOS]
8. Don't let an action sheet scroll; more buttons mean more effort and a risk of mis-taps. [iOS, iPadOS]
9. Show no more than four buttons including Cancel, so no more than three other choices. [watchOS]

## How it applies to a web app on iPhone and Mac

- When an action needs a follow-up choice (closing a task editor with unsaved changes: Discard Changes / Save / Keep Editing), show a small confirm dialog; on the phone it's a bottom sheet of full-width buttons.
- Order on the phone: the destructive choice (red, `variant="destructive"`) at the top, other choices below, Cancel last at the bottom.
- Keep it to a one-line title and three or four buttons, never a scrolling list.
- Don't use a `DropdownMenu` for these follow-up choices: menus are for things people open on purpose.
