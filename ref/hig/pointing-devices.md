# Pointing devices
Source: https://developer.apple.com/design/human-interface-guidelines/pointing-devices

## In one line
Make the mouse and trackpad behave the way they do everywhere else, give targets comfortable hit areas, and change the pointer only when it tells people something.

## Rules
1. Respond to mouse and trackpad gestures the same way the rest of the system does (for example "Swipe between pages" goes back and forward). [Best practices]
2. Don't redefine systemwide trackpad gestures. [Best practices]
3. Keep the experience the same whether people use touch, a pointer or a keyboard; they switch freely and won't learn separate ways for each. [Best practices]
4. Let the pointer reveal and hide controls that minimize or fade out (like a hidden toolbar or video controls). [Best practices]
5. A modifier key held during an action (like Option while dragging to duplicate) must give the same result with touch and with the pointer. [Best practices]
6. Allow multiple selection by dragging a rectangle over items in custom views where it's needed. [iPadOS]
7. Treat pointer and finger input differently only when it adds value (like clicking an exact spot on a video scrubber). [iPadOS]
8. Use the standard pointer looks for standard buttons and text areas (I-beam over text). [iPadOS, Standard pointers and effects]
9. Give interactive elements comfortable hit areas: about 12 points of padding around elements with a visible border, about 24 points around elements without one. Make hit areas of neighboring bar buttons touch, with no gaps between them. [iPadOS, Standard pointers and effects]
10. Use pointer and hover effects consistently, never just for decoration, and keep custom pointer shapes simple and instantly understood. [iPadOS, Customizing pointers]
11. Don't show instructional text with the pointer; useful annotations (like current width and height while resizing) are fine. [iPadOS, Customizing pointers]
12. Don't scale an element on hover if it would crowd its neighbors (like a table row); use a tint instead, and don't add a shadow without scale. [iPadOS, Customizing pointers]
13. On Mac, primary click selects or activates; secondary click shows a context menu; scrolling, pinch-to-zoom and swipe-between-pages keep their usual meanings. [macOS]
14. On Mac, use the standard pointer for its meaning: pointing hand for links, open and closed hand for draggable and dragging content, resize arrows for dividers and edges, "operation not allowed" where a dragged item can't drop, drag copy when Option is held during a drag. [macOS, Pointers]
15. Controls that only appear on hover need another way to appear for touch: reveal them on a tap in their area (hiding them again after use or a few seconds), keep the selection when revealing them, and put the essential ones in a context menu. Don't just leave them always visible. [macOS, Touch support for hidden controls]

## How it applies to a web app on iPhone and Mac
- Use the matching CSS `cursor` (`pointer` on links and clickable cards, `grab`/`grabbing` on drag handles, `col-resize` on column dividers, `not-allowed` over invalid drop targets, `text` in fields); don't invent custom cursors.
- Right-click on a card or row opens its context menu (shadcn `ContextMenu`), with the same actions as its "..." menu; on iPhone the same menu opens from a visible button or a long press.
- Anything that appears only on hover (row actions, a card's quick buttons) must also be reachable on iPhone, through a visible "..." button or a tap, since iPhone has no hover. Use `@media (hover: hover)` to decide.
- Keep hit areas generous on Mac too (padding around small icons), and hover styles subtle: tint, not scale, for rows and cards in lists.
- Don't block the trackpad's back and forward swipe or pinch-zoom on the page.
