# Gestures
Source: https://developer.apple.com/design/human-interface-guidelines/gestures

## In one line
Make standard gestures do what people expect, respond instantly, and never make a gesture the only way to do something.

## Rules
1. Give people more than one way to do things (voice, keyboard, Switch Control); don't assume anyone can make a given gesture. [Best practices]
2. Respond to gestures the way people expect everywhere: tap activates or selects. Don't use a familiar gesture (tap, swipe) for an action unique to your app, and don't invent a new gesture for a standard action like pressing a button or scrolling. [Best practices]
3. Respond to gestures as quickly as possible, with feedback during the gesture that helps people predict the result and shows how far or how much they need to move. [Best practices]
4. Show when a gesture isn't available (a locked item that can't be dragged, a disabled button that looks clearly different), so people don't think the app froze or they did it wrong. [Best practices]
5. Add custom gestures only when needed, for frequent specialized tasks no standard gesture covers. Make them discoverable, easy to do, distinct from other gestures, and never the only way to do something important. [Custom gestures]
6. Make custom gestures easy to learn; if they're hard to describe simply, they'll be hard to do. Test them in real use. [Custom gestures]
7. Use shortcut gestures alongside standard controls, not instead of them: keep the Back button even if swiping from the edge also goes back. [Custom gestures]
8. Don't define gestures that clash with the ones that reach system UI. [Custom gestures]
9. Standard gestures and their actions: tap activates or selects; swipe reveals actions, dismisses views, scrolls; drag moves an element; touch and hold reveals more controls; double tap zooms (or zooms back out); pinch zooms; rotate rotates. [Specifications, Standard gestures]
10. On iPhone, keep three-finger swipe (undo left, redo right), three-finger pinch (copy in, paste out) and shake (undo, redo) working. [Platform considerations, iOS, iPadOS]
11. On a Mac with touch, keep the layout and size of elements the same when touch is used; make tap targets bigger, not the controls. [Platform considerations, macOS]
12. On a Mac with touch, don't make touch the only way to reach anything, and give touch equivalents for pointer-only actions like shift-drag or hover menus. [Platform considerations, macOS]
13. Make custom gestures work with both touch and trackpad. [Platform considerations, macOS]

## How it applies to a web app on iPhone and Mac
- Tap opens or selects, touch and hold opens a context menu or picks up a card, swipe scrolls or reveals row actions; don't give these other meanings.
- Every swipe or long-press action (swiping between columns, pressing to drag) also has a visible button or menu item, and works from the keyboard.
- Give feedback while the finger moves (the card lifts, the column follows the finger) and snap back if the gesture is cancelled.
- Don't capture swipes from the screen edges, which Safari uses for back and forward, or block pinch-zoom; keep `touch-action` limits to the elements that need them.
- Make small controls' tap areas larger than they look (padding or a pseudo-element), rather than making the controls bigger on touch.
