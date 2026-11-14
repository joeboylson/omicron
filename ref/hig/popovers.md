# Popovers
Source: https://developer.apple.com/design/human-interface-guidelines/popovers

## In one line

A popover is a small, temporary view pointing at the control that opened it, for a few related tasks; one at a time, saving work when it closes, and not on iPhone-sized screens.

## Rules

1. Use a popover for a small amount of information or functionality, limited to a few related tasks (like changing an event's date or calendar). [Best practices]
2. Consider a popover for content needed only temporarily, instead of a space-hungry sidebar or panel. [Best practices]
3. Point the popover's arrow as directly as possible at the element that opened it, and don't cover that element or content people need while using it. [Best practices]
4. Add a Close, Cancel or Done button only when it adds clarity (like leaving with or without saving); otherwise the popover closes on a click or tap outside it or on choosing an item. If several selections are possible, it stays open until dismissed. [Best practices]
5. Always save people's work when a nonmodal popover closes automatically; discard it only on an explicit Cancel. [Best practices]
6. Show one popover at a time, never a cascade of popovers opening from popovers; close the open one before showing a new one. [Best practices]
7. Show nothing on top of a popover except an alert. [Best practices]
8. Let people close one popover and open another with a single click or tap, especially when several bar buttons each open one. [Best practices]
9. Make a popover only as big as its content needs; animate any change in its size so it doesn't look like a new popover. [Best practices]
10. Don't use the word "popover" in help text; name the task or control instead. [Best practices]
11. Don't use a popover for a warning, since it can be missed or closed by accident; use an alert. [Best practices]
12. Avoid popovers in compact views (like iPhone); show the content full-screen, such as in a sheet. Reserve popovers for wide views. [iOS, iPadOS]
13. On Mac, consider letting people detach a popover into a panel, changing its look as little as possible. [macOS]

## How it applies to a web app on iPhone and Mac

- shadcn `Popover` is the popover on Mac-width screens: anchored to its trigger, small, closes on an outside click or Escape.
- At phone width, the same content opens as the bottom-sheet `Dialog` instead of a floating popover.
- Edits made in a popover (like picking labels or a due date) save as they happen, so an outside click never loses them; only Cancel throws them away.
- Multi-select pickers (Popover + Command for labels or members) stay open while people pick several; single-choice pickers close on the choice.
- Never open a popover from inside a popover, and never use one to show a warning (use `AlertDialog`).
