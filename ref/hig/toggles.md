# Toggles
Source: https://developer.apple.com/design/human-interface-guidelines/toggles

## In one line

A toggle switches between two opposite states; make the on and off looks obviously different, use a switch only in list rows on iPhone, and checkboxes or radio buttons for groups on Mac.

## Rules

1. Use a toggle only to choose between two opposing values that affect content or a view; for other actions, like choosing from a list, use another control such as a pop-up button. [Best practices]
2. Make clear what setting, view or content the toggle affects; a toggle-style button uses an icon and changes its appearance (usually its background) with its state. [Best practices]
3. Make the on and off states visibly different (fill, background shape, checkmark or dot), never by color alone. [Best practices]
4. Use the switch style only in a list row; the row's content is its label, so it needs no separate one. [iOS, iPadOS]
5. Keep the switch's default green unless there's a reason; an accent color is fine if it contrasts clearly with the off look. [iOS, iPadOS]
6. Outside a list, use a button that acts as a toggle (like the Phone app's filter button with a blue highlight when on), not a switch, and don't add a label explaining it. [iOS, iPadOS]
7. Put switches, checkboxes and radio buttons in the window body, never in a toolbar or status bar. [macOS]
8. Prefer a switch for settings you want to emphasize, such as one that turns a group of settings on or off; don't replace an existing checkbox with a switch. [macOS]
9. Use checkboxes, aligned on the leading edge and indented, to show a hierarchy of settings; a parent checkbox shows a mixed state (dash) when its children differ. [macOS]
10. A group of checkboxes whose relationship isn't clear gets a label describing the set, aligned with the first checkbox's baseline. [macOS]
11. Use radio buttons, in groups of two to five, for more than two mutually exclusive options; past about five, use a pop-up button. [macOS]
12. For a single on/off setting, prefer a checkbox over a single radio button. [macOS]
13. Space horizontal radio buttons evenly, using the width of the longest label. [macOS]

## How it applies to a web app on iPhone and Mac

- shadcn `Switch` belongs in a settings-style list row whose text names the setting; don't scatter switches in toolbars.
- A toggle in a toolbar or filter bar is a shadcn `Toggle` (a button that stays pressed, with a filled background when on), not a `Switch`.
- `Checkbox` for checklists and nested options (with the indeterminate state for a parent); `RadioGroup` for two to five exclusive options, a `Select` past five.
- On and off differ in shape or fill, not only color; give each control an accessible name.
- Rows holding a switch or checkbox are at least 44 px tall and the whole row toggles on tap.
