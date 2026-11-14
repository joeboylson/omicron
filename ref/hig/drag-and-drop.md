# Drag and drop
Source: https://developer.apple.com/design/human-interface-guidelines/drag-and-drop

## In one line
Support dragging wherever people would try it, show clearly and continuously what a drop will do, and let them undo it.

## Rules
1. Support drag and drop throughout the app; people know it and try it everywhere. [Best practices]
2. Offer another way to do every drag-and-drop action (for example menu commands to move or copy an item), and make sources and destinations usable with assistive technology. [Best practices]
3. Decide whether a drop moves or copies: within the same container it usually moves, to a different container it copies. Prefer whichever is least likely to frustrate or lose data. [Best practices]
4. Let people drag several selected items as a group when it makes sense. [Best practices]
5. Let people undo a drop. For a drop that can't be undone, consider asking first, or give a way to reverse it afterwards. [Best practices]
6. Consider spring loading: dragging content over a control (a button, a segmented control) activates it, like dragging an event onto Calendar's Week segment. [Best practices]
7. Show a translucent drag image as soon as the selection moves about three points, and keep it until the drop. [Providing feedback]
8. Change the drag image only if it helps predict the result (for example group several items together), never constantly or wildly. [Providing feedback]
9. Show whether a destination can accept the item: an insertion point or highlight only where a drop is allowed, nothing or a "not allowed" symbol where it isn't, and only while the item is over it. With several possible targets, mark one at a time. [Providing feedback]
10. When a drop lands somewhere invalid or fails, show it: send the item back to its source if visible, or make it scale up and fade away. [Providing feedback]
11. Auto-scroll a long scrolling destination while people drag over it, and stop once they drag outside it. [Accepting drops]
12. Take the richest version of dropped content you can use, and only the relevant part of it (Mail takes just a contact's name and email). [Accepting drops]
13. If dropped content takes time to arrive, show progress and a placeholder where it will land; if a drop starts a task, show that it started and how it's going. [Accepting drops]
14. Keep dropped content selected at its new place so people can act on it right away; deselect it in the source. [Accepting drops]
15. On Mac, consider a count badge on multi-item drags, change the pointer to show what will happen (copy, link, not allowed), and let people select and drag in one motion. [Platform considerations, macOS]

## How it applies to a web app on iPhone and Mac
- Cards and list rows should be draggable between columns and positions, with a keyboard or menu alternative ("Move to..." in the card menu) and screen-reader announcements (dnd-kit's keyboard sensor and announcements do this).
- Show a lifted, translucent copy of the card, a clear insertion line where it will land, and a highlight only on columns that will accept it; on an invalid drop, animate the card back.
- Auto-scroll the board sideways and columns up and down near their edges while dragging.
- After a drop, keep the card selected in its new spot and offer Undo for the move.
- On iPhone, a press-and-hold starts the drag so normal scrolling still works; on Mac, start dragging after a few pixels of movement so clicks still click.
