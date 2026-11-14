# Pull-down Buttons
Source: https://developer.apple.com/design/human-interface-guidelines/pull-down-buttons

## In one line

A pull-down button opens a menu of commands tied to the button's own purpose (Add what, Sort by what); don't use it to hide a view's main actions.

## Rules

1. Use a pull-down button for commands or items directly related to the button's action, such as an Add button that asks what to add or a Sort button that asks what to sort by. [Best practices]
2. For a list of mutually exclusive choices that aren't commands, use a pop-up button instead. [Best practices]
3. Don't put all of a view's actions in one pull-down button; primary actions must be easy to find without opening anything. [Best practices]
4. List at least three items so opening the menu is worth it; for one or two, use plain buttons, toggles or switches instead. Too many items slow people down too. [Best practices]
5. Show a short menu title only when it adds meaning; usually the button and item labels are enough. [Best practices]
6. Mark destructive items (red text) and ask people to confirm them, in an action sheet on iPhone or a popover on iPad. [Best practices]
7. Add an icon after an item's label only when it clarifies the item. [Best practices]
8. A More button (ellipsis icon) can hold items that don't need a prominent spot, but it hurts discoverability; weigh the space saved against that. [iOS, iPadOS]
9. A pull-down menu can also open from a gesture on a button, like touch and hold (Safari's Tabs button). [iOS, iPadOS]

## How it applies to a web app on iPhone and Mac

- A shadcn `Button` as a `DropdownMenuTrigger` is a pull-down button; the menu rules in `menus.md` apply to its items.
- A "…" (More) button on a card or row is fine for secondary actions, but the main action (like opening or moving a task) stays visible on its own.
- A menu with only one or two items should be buttons instead.
- A destructive item in the menu is red and opens a confirm step (an `AlertDialog`) rather than acting at once.
- To pick one value (not run a command), use a `Select` instead.
