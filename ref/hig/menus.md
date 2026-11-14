# Menus
Source: https://developer.apple.com/design/human-interface-guidelines/menus

## In one line

A menu hides a list of commands until opened; label items as short Title Case verbs, put the common ones first, group related ones, and keep it short and flat.

## Rules

1. Label each item clearly and briefly; an item that does something starts with a verb or verb phrase (View, Close, Select). [Labels]
2. Use title-style capitalization: capitalize every word except articles, coordinating conjunctions and short prepositions, and always capitalize the last word. [Labels]
3. Leave out articles (a, an, the): "View Settings", not "View the Settings". [Labels]
4. Show unavailable items dimmed and unresponsive; if every item is unavailable, the menu itself still opens. [Labels]
5. Add an ellipsis (…) to an item that needs more input before it can finish, usually in another view. [Labels]
6. Use standard icons for common actions (Share, Print, Search), use icons sparingly, and skip an icon if none clearly fits. [Icons]
7. In a group, give icons to every item or to none. [Icons]
8. List important or frequently used items first. [Organization]
9. Group related items and separate groups with a separator; keep related commands together even when some are rarely used. [Organization]
10. Watch menu length: split a long menu or use a submenu, except for user-made or growing lists (like history), where a long scrolling menu is fine. [Organization]
11. Use submenus sparingly: consider one when a term repeats in more than two items in a group ("Sort by" → Date, Score, Time), keep them one level deep, and consider a new menu if a submenu has more than about five items. [Submenus]
12. A submenu stays openable even when everything in it is unavailable; use a submenu, never indentation, to show hierarchy. [Submenus]
13. For something that turns on and off, consider one item whose label changes (Show Map / Hide Map), add a verb if the label could be read as a state (Turn HDR On), or show both items when seeing both helps. [Toggled items]
14. Use a checkmark to show an attribute is in effect, and consider an item that clears several at once (like Plain). [Toggled items]
15. On iPhone and iPad, a menu can open as a small layout (a top row of four icon-only items), medium (three icons with short labels) or large (a plain list, the default); use small only for closely related actions like Bold, Italic, Underline. [iOS, iPadOS]

## How it applies to a web app on iPhone and Mac

- shadcn `DropdownMenu` (and `ContextMenu`) is the menu: `DropdownMenuSeparator` between groups, `DropdownMenuSub` for at most one level of submenu.
- Item labels are Title Case verbs with no articles ("Copy Link", "Move to Project…"); items that open a dialog end in "…".
- Disabled items use the `disabled` prop (dimmed), not removal; the trigger stays clickable.
- Use `DropdownMenuCheckboxItem` / `DropdownMenuRadioItem` for on/off and pick-one options, so the checkmark shows what's in effect.
- Icons on menu items: all or none within a group; on Mac the item can show its keyboard shortcut with `DropdownMenuShortcut`.
- Items are full-width rows tall enough to tap on a phone (44 px).
