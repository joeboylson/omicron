# Layout

Source: https://developer.apple.com/design/human-interface-guidelines/layout

## In one line

Put the most important things first, line things up and group them, and make one layout that adapts to whatever space, text size and language it gets, without hiding features.

## Rules

1. Order content by importance: people read top to bottom and leading to trailing side, so put the most important items near the top and leading side of the window. [Visual hierarchy]
2. Use standard components that flip automatically for right-to-left languages instead of hard-coding left and right. [Visual hierarchy]
3. Align elements so they're easy to scan; use indentation to show that an item belongs under the one before it. People read aligned items as related and indented items as subordinate. [Visual hierarchy]
4. Group related items with empty space, container shapes or separator lines, so it's clear what belongs together and what doesn't. [Visual hierarchy]
5. Use progressive disclosure: show less at first and put the rest behind disclosure triangles, menus, nested views or scrollable sections. Too many choices at once make things hard to find. [Visual hierarchy]
6. Make controls look distinct from content. Lift controls above content with a scroll edge effect rather than a solid or semi-opaque background colour under them. [Visual hierarchy]
7. Full-screen background content extends under sidebars, toolbars and tab bars to fill the whole window. [Visual hierarchy]
8. The layout adapts gracefully and consistently when people rotate the device, resize the window, add a display or switch device; it should still feel familiar. Respect safe areas, margins and guides. [Adaptability]
9. Be ready for larger text: side-by-side views may need to stack, and rows and containers grow taller so text is never cropped or overlapping; single-line rows may need to wrap to several lines. [Adaptability]
10. Test the largest and smallest layouts first, across sizes, localizations and text sizes, checking for clipping. [Adaptability]
11. Scale background artwork to fill the screen; never change its aspect ratio. Expect very wide-and-short or tall-and-narrow windows. [Adaptability]
12. Decide layout from the space actually available (compact vs. regular width and height), not from device type or orientation. [Size classes]
13. Design for every combination of compact and regular width and height, in portrait and landscape. [Size classes]
14. Keep functionality the same at every size. You may show more or less of it on screen (for example switch a tab bar to a sidebar, or bring items out of an overflow menu when there's room), but don't change what the app can do. [Size classes]
15. Keep the layout recognisable and familiar to the platform when it's resized. [Size classes]
16. Keep content and controls inside the safe area so the Dynamic Island, status bar, toolbars and tab bars don't cover them. [Guides and safe areas]
17. On a Mac, don't put controls or critical information at the bottom of a window: people often drag windows so the bottom edge is off screen. [macOS]
18. On a Mac, don't put content behind the camera housing at the top edge of the window. [macOS]

## How it applies to a web app on iPhone and Mac

- Size classes map to CSS media or container queries on the page's real width and height. Never sniff the user agent or device; an iPhone in landscape and a narrow Mac window should get the layout their width calls for.
- Rule 14 means the phone and desktop layouts offer the same actions. A phone may tuck them into a menu or sheet, but nothing goes missing.
- Safe areas on iPhone: add `viewport-fit=cover` to the viewport meta and pad fixed headers, bottom bars and sheets with `env(safe-area-inset-top|bottom|left|right)`, so the notch, Dynamic Island and home indicator don't cover them.
- Larger text in the browser is page zoom on Mac (up to 200%) and Safari's text size on iPhone. Use `rem` for type, let rows grow (`min-height`, not fixed `height`), let text wrap, and let side-by-side groups stack (flex-wrap or a breakpoint) instead of clipping.
- Use CSS logical properties (`margin-inline-start`, `padding-inline`, `text-align: start`) so a right-to-left language flips the layout (rule 2).
- Rule 6 on the web: a sticky header that blurs or fades the content scrolling under it (`backdrop-filter`, a gradient mask) rather than a flat opaque bar.
- Rule 17 is about Mac windows; on the Mac browser keep primary actions near the top of a page or panel, not only in a footer. On iPhone a bottom bar is normal but must clear the home indicator (safe-area inset).
