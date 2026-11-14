# Accessibility

Source: https://developer.apple.com/design/human-interface-guidelines/accessibility

## In one line

Make the app usable whatever someone's sight, hearing, movement or attention: scalable text, enough contrast, big well-spaced targets, labels for screen readers, keyboard-only use, simple gestures with button alternatives, and calm motion.

## Rules

1. Let people enlarge text by at least 200 percent. [Vision]
2. Use the platform's default and minimum text sizes: iOS/iPadOS 17pt default, 11pt minimum; macOS 13pt default, 10pt minimum. Go larger for thin-weight fonts. [Vision]
3. Meet minimum contrast (WCAG AA): text up to 17pt needs 4.5:1; text 18pt and larger needs 3:1; bold text of any size needs 3:1. [Vision]
4. If the default colours fall short of that, at least provide a higher-contrast scheme when Increase Contrast is on; check contrast in both light and dark appearances. [Vision]
5. Prefer system colours, which have accessible variants for Increase Contrast and light/dark. [Vision]
6. Never convey information by colour alone; add shapes or icons for differences in function and state (red-green and blue-orange pairs are especially hard). Consider letting people customise colours such as chart colours. [Vision]
7. Describe the interface and content for VoiceOver (screen readers). [Vision]
8. Don't communicate dialogue or crucial information by audio alone; offer captions, subtitles, audio descriptions or transcripts. [Hearing]
9. Pair audio cues with haptics, and with visual cues that point to where to act. [Hearing]
10. Make controls big enough: iOS/iPadOS default 44x44pt, minimum 28x28pt; macOS default 28x28pt, minimum 20x20pt. [Mobility]
11. Treat spacing as being as important as size: about 12pt of padding around elements with a bezel (a visible border or background), about 24pt around the visible edges of elements without one. [Mobility]
12. Use the simplest gesture possible for frequent actions; avoid custom multi-finger gestures. [Mobility]
13. Offer an on-screen alternative to every gesture: if a swipe dismisses a view, also provide a button. [Mobility]
14. Label interface elements so Voice Control and other assistive technologies (Full Keyboard Access, Switch Control, Pointer Control) can operate them; test with them. [Mobility]
15. Everything works with the keyboard alone. Don't override system keyboard shortcuts. [Speech]
16. Keep actions simple and consistent; prefer familiar system gestures and behaviours over custom ones people must learn. [Cognitive]
17. Avoid things that dismiss themselves on a timer; prefer dismissing with an explicit action. [Cognitive]
18. Don't autoplay audio or video without discoverable controls to start and stop it. [Cognitive]
19. Go easy on fast-moving and blinking animation. With Reduce Motion on, cut automatic and repeating animation (zooming, scaling, peripheral motion): tighter springs with less bounce, animations that track the finger, no animated depth changes, fades instead of slides, no animating into or out of blur. [Cognitive]
20. In a simplified mode (Assistive Access): remove non-essential workflows, one interaction per screen, and confirm twice before actions that are hard to undo, such as deleting. [Cognitive]

## How it applies to a web app on iPhone and Mac

- Text sizes in `rem` and layouts that hold at 200% browser zoom (rule 1); see typography.md for sizes in px (px ≈ pt).
- Tap targets: at least 44x44px on phone widths and 28x28px on desktop; never below 28x28px on phone or 20x20px on Mac (rule 10). An icon can stay small if its hit area (padding or a pseudo-element) is the full size. Space bordered buttons about 12px apart, borderless ones about 24px (rule 11).
- Contrast (rule 3): 4.5:1 for normal text, 3:1 only for bold text or text 18px and up. Apple's table uses pt sizes; WCAG's own "large text" line is 18pt in CSS points (24px), so text between 18px and 24px that isn't bold is safest held to 4.5:1. Add a `@media (prefers-contrast: more)` theme (rule 4).
- Screen readers and Voice Control (rules 7, 14): real `<button>` and `<a>` elements, `aria-label` on icon-only buttons, labels tied to inputs, and Radix/shadcn primitives, which already carry the right roles.
- Keyboard (rule 15): every action reachable by Tab, visible `:focus-visible` rings, Escape closes dialogs; don't claim Safari's shortcuts (Cmd+L, Cmd+W, Cmd+T, Cmd+F, and so on).
- Gestures (rules 12-13): every swipe, drag or long-press (drag a card, swipe between columns) has a button or menu item that does the same thing.
- Motion (rule 19): wrap transitions in `@media (prefers-reduced-motion: no-preference)`, or swap slides for fades under `reduce`.
- Toasts (rule 17): important ones stay until dismissed; anything with an action shouldn't vanish on a timer.
