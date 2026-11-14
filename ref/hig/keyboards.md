# Keyboards
Source: https://developer.apple.com/design/human-interface-guidelines/keyboards

## In one line
Let people do everything from the keyboard, keep the standard shortcuts meaning what they always mean, and add few custom ones.

## Rules
1. Support Full Keyboard Access: people must be able to reach and use every window, menu and control with the keyboard alone. [Best practices]
2. Respect the standard shortcuts people know from other apps. For a frequent action unique to your app, make a new shortcut instead of reusing a standard one. [Best practices]
3. Don't repurpose a standard shortcut unless its usual action makes no sense in your app (an app without text editing could use Command-I for Get Info instead of Italic). [Standard keyboard shortcuts]
4. Keep the standard meanings, including: Esc and Command-Period cancel; Tab and Shift-Tab move between controls; Command-Comma opens settings; Command-Question mark opens help; Command-F finds, Option-Command-F jumps to the search field; Command-A selects all; Command-C, X, V copy, cut, paste; Command-Z undo, Shift-Command-Z redo; Command-N new; Command-S save; Command-W close; Command-J scrolls to the selection; Control-Command-F enters full screen. [Standard keyboard shortcuts]
5. Add custom shortcuts only for the most frequently used app-specific commands; too many make the app seem hard to learn. [Custom keyboard shortcuts]
6. Use modifiers the way people expect: Command while dragging moves items as a group, Shift while resizing keeps the aspect ratio, and holding an arrow key moves the selection by the smallest step. [Custom keyboard shortcuts]
7. Make Command the main modifier, Shift a secondary one for a related shortcut, Option rarely (less common or power features), and avoid Control, which the system uses widely. [Custom keyboard shortcuts]
8. Avoid extra modifiers with characters that aren't on every keyboard; if you need a modifier besides Command, use it with letters only. [Custom keyboard shortcuts]
9. List modifiers in this order: Control, Option, Shift, Command. [Custom keyboard shortcuts]
10. For the upper character of a two-character key, show that character, not Shift plus the lower one: Command-Question mark, not Shift-Command-Slash. [Custom keyboard shortcuts]
11. Don't make a new shortcut by adding a modifier to an existing one for an unrelated command (Shift-Command-Z must stay about undo and redo). [Custom keyboard shortcuts]
12. Let the system localize shortcuts for the connected keyboard and mirror them for right-to-left layouts. [Custom keyboard shortcuts]

## How it applies to a web app on iPhone and Mac
- Every control must be reachable with Tab, show a visible focus ring, and work with Enter or Space; menus, dialogs and the board need arrow keys and Escape (Radix-based shadcn parts do most of this). This also covers iPad and iPhone with a hardware keyboard.
- Use `metaKey` (Command) as the modifier on Mac, and don't take over browser shortcuts like Command-W, T, N, L, R or Q; web pages can't, or shouldn't, reuse those.
- Keep a short list of app shortcuts (for example `/` or Command-K to search, Command-Comma for settings, Command-Enter to submit), show them in menus and tooltips with the Mac symbols in Control, Option, Shift, Command order, and list them on a help screen.
- Don't fire single-key shortcuts while a text field has focus.
