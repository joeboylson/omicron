# Color

Source: https://developer.apple.com/design/human-interface-guidelines/color

## In one line

Give each colour one meaning, define every colour by its purpose with light, dark and high-contrast versions, use colour sparingly on controls, and never let colour be the only way information is shown.

## Rules

1. Don't use the same colour to mean different things. Use colour consistently, especially for status and interactivity: if the brand colour marks a borderless button as tappable, don't also use it on text that isn't. [Best practices]
2. Every colour works in light, dark and increased-contrast settings. Give each custom colour a light and a dark version, each with an increased-contrast version that is clearly more distinct. [Best practices]
3. Test the colour scheme in bright and dim light: colours look darker and muted in sunlight, brighter and more saturated in the dark. [Best practices]
4. Test on different devices and colour profiles (True Tone, P3 vs. sRGB). [Best practices]
5. Consider how artwork and translucency change nearby colours; colours look different behind a translucent bar. [Best practices]
6. When people pick colours, use the system colour picker. [Best practices]
7. Never rely on colour alone to tell things apart, show interactivity or carry essential information; also use text labels or shapes. [Inclusive color]
8. Avoid colours and combinations that are hard to see: low contrast, or pairs people with colour blindness can't tell apart. [Inclusive color]
9. Check what colours mean in other cultures (red is danger in some, positive in others). [Inclusive color]
10. Don't hard-code system colour values; they change between releases. Use them through the system. [System colors]
11. Define colours by purpose (background levels, label, secondary label, link, separator), not by how they look. [System colors]
12. Don't repurpose a semantic colour: don't use the separator colour for text, or the secondary label colour as a background. [System colors]
13. Apply colour to controls sparingly, only on things that truly need emphasis such as status indicators or the primary action. For a primary action, colour the button's background (as the Done button does with the accent colour), not its text or icon. Don't colour the backgrounds of several controls. [Liquid Glass color]
14. On colourful backgrounds, keep toolbar and tab bar labels monochrome or pick an accent colour that stands well apart. In a mostly monochrome app, the brand colour works well as the accent colour. [Liquid Glass color]
15. Keep colourful content from sitting under similarly coloured controls, at least in the resting state (the top of a scrolled page). [Liquid Glass color]
16. Use sRGB colour profiles on images; use Display P3 where wide colour adds meaning, and check similar P3 colours and gradients still read on sRGB screens. [Color management]
17. Use background levels for hierarchy: primary for the whole view, secondary for groups inside it, tertiary for groups inside those. Use the "grouped" set for grouped lists. [iOS, iPadOS]
18. iOS foreground colours: label, secondary, tertiary and quaternary label for decreasing importance; placeholder text; separator and opaque separator; link. [iOS, iPadOS]
19. On a Mac, people's chosen accent colour (System Settings > General) replaces the app's accent colour unless they picked multicolor. [macOS]

## How it applies to a web app on iPhone and Mac

- Rule 11 is CSS variables named by role (`--background`, `--foreground`, `--muted-foreground`, `--border`, `--primary`, `--destructive`), which is how shadcn's theme already works. Components use the role, never a raw hex value (rules 10 and 12).
- Give every variable a light and a dark value (`prefers-color-scheme`, or shadcn's `.dark` class) and a stronger value under `@media (prefers-contrast: more)` (rule 2).
- Rule 1 and 13 for the board: one accent colour for "you can tap this" and the primary button; status colours (done, failing, waiting) each kept to a single meaning and always paired with a word or icon (rule 7).
- CSS `accent-color` and `AccentColor` (Safari) can follow the Mac's chosen accent for native checkboxes and radios; custom shadcn controls use the app's own `--primary`.
- `<input type="color">` is the system picker in Safari (rule 6).
- Wide colour: CSS `color(display-p3 ...)` inside `@media (color-gamut: p3)`, with an sRGB fallback (rule 16).
- Test in both themes on a phone outdoors and a Mac at night, and with Increase Contrast on (rules 2-3).
