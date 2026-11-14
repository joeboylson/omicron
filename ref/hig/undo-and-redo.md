# Undo and redo
Source: https://developer.apple.com/design/human-interface-guidelines/undo-and-redo

## In one line
Let people reverse what they did, many times, and always show them what an undo changed.

## Rules
1. Help people predict what undo and redo will do: name the action in the label, like "Undo Typing" or "Redo Bold". [Best practices]
2. Show the result of each undo or redo. If it affects something off screen, bring it into view (for example scroll to a restored paragraph), so people don't think nothing happened and press it again. [Best practices]
3. Let people undo many times. Don't put needless limits on undo and redo; people expect to undo everything since a logical step like opening or saving. [Best practices]
4. Consider letting people undo a batch of related changes at once (like many small tweaks to one property), or everything since opening or saving. [Best practices]
5. Add undo and redo buttons only when needed; people expect the system ways (Edit menu, keyboard shortcuts, shaking an iPhone). If you add buttons, use the standard symbols and put them in a toolbar. [Best practices]
6. Don't redefine the standard undo gestures (three-finger swipe, shaking the iPhone). [iOS, iPadOS]
7. Describe the action briefly and precisely after "Undo " or "Redo ", like "Undo Name" or "Redo Address Change". [iOS, iPadOS]
8. On Mac, support Command-Z for undo and Shift-Command-Z for redo (and put them at the top of the Edit menu). [macOS]

## How it applies to a web app on iPhone and Mac
- After a change like moving, archiving or deleting a card, show a toast with a named "Undo" action ("Undo Move to Done") instead of asking "Are you sure?" first.
- Support Command-Z and Shift-Command-Z on the page for board actions when no text field has focus; inside text fields, leave the browser's own undo alone.
- When an undo restores something, scroll to it and briefly highlight it.
- Keep a stack of several undo steps, not just the last one.
