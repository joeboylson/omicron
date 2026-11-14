# Buttons
Source: https://developer.apple.com/design/human-interface-guidelines/buttons

## In one line

A button does one thing right away; make it big enough to hit, say plainly what it does, and give the most likely choice the prominent style.

## Rules

1. Give every button a hit region of at least 44x44 pt (60x60 pt in visionOS), with enough space around it to tell it apart from what's nearby. [Best practices]
2. Every custom button has a visible press state, or it feels unresponsive. [Best practices]
3. Use a prominent (accent-colored) style for the most likely action in a view, and keep prominent buttons to one or two per view. [Style]
4. Use style, not size, to mark the preferred choice among several options: buttons offered as a set are the same size, with the preferred one in a more prominent style. [Style]
5. Don't give button labels the same color as a brightly colored background behind them; prefer the default monochrome labels over colorful content. [Style]
6. Each button clearly says what it does, with a symbol, a text label, or both; use familiar icons for familiar actions (for example the share icon for sharing). [Content]
7. Use text when a short label is clearer than an icon: a few words, title-style capitalization, ideally starting with a verb ("Add to Cart"). [Content]
8. Give the primary role to the button people are most likely to choose; it responds to Return, and in a sheet, editable view or alert, Return confirms and closes it. [Role]
9. Never give the primary role to a destructive button, even if it's the most likely choice; destructive buttons use the system red. [Role]
10. When an action doesn't finish instantly, show an activity indicator in the button, optionally with a changed label ("Checkout" becomes "Checking out…"). [iOS, iPadOS]
11. Add a trailing ellipsis to a button's title when it opens another window, view or app where people give more input. [macOS]
12. Buttons that act on a view (like adding or removing table rows) sit inside or just beneath that view, use a symbol rather than text, and don't belong in the toolbar. [macOS]
13. Have at most one help button per window, placed in the lower corner of a dialog, and open the help topic for the current context. [macOS]
14. Mac shows a tooltip when the pointer rests on a button: give icon buttons a short phrase saying what they do. [Content]

## How it applies to a web app on iPhone and Mac

- Every shadcn `Button` (and icon button) needs a 44x44 px tap area on the phone, even when the visible button is smaller; `components/base/` is the place to enforce it.
- One `variant="default"` (filled) button per dialog or page area for the main action; the others `outline`, `secondary` or `ghost`, all the same size.
- Destructive buttons use `variant="destructive"` and are never the one Enter submits; the form's Enter key goes to the safe primary action.
- Labels are verbs in Title Case ("Add Task", "Move to Review"); icon-only buttons get a `title`/tooltip and an `aria-label`.
- A button whose action takes time shows a spinner inside it and an "-ing…" label while it waits, rather than a separate loading message.
- A button that opens a dialog for more input ends in "…" ("Rename…").
