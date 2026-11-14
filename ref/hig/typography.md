# Typography

Source: https://developer.apple.com/design/human-interface-guidelines/typography

## In one line

Use few typefaces at readable sizes and normal-to-bold weights, build hierarchy from a fixed set of text styles, and make every layout survive much larger text.

## Rules

1. Use the platform's default and minimum text sizes, for system and custom fonts alike: iOS/iPadOS 17pt default, 11pt minimum; macOS 13pt default, 10pt minimum. [Ensuring legibility]
2. If a font has a thin weight, go larger than those sizes. [Ensuring legibility]
3. Avoid light weights. Prefer Regular, Medium, Semibold or Bold; avoid Ultralight, Thin and Light, especially for small text. [Ensuring legibility]
4. Test legibility in real contexts; if text is hard to read, make it bigger, raise contrast, or use a typeface designed for legibility. [Ensuring legibility]
5. Show hierarchy with weight, size and colour, and keep that hierarchy intact when people change text size. [Conveying hierarchy]
6. Use as few typefaces as possible, even in a highly customised interface. [Conveying hierarchy]
7. When text gets bigger, grow the content people care about first; things like tab titles needn't grow. [Conveying hierarchy]
8. Use a fixed set of text styles (each a weight, size and leading) rather than one-off sizes. iOS Large (default) sizes: Large Title 34/41, Title 1 28/34, Title 2 22/28, Title 3 20/25, Headline 17/22 Semibold, Body 17/22, Callout 16/21, Subhead 15/20, Footnote 13/18, Caption 1 12/16, Caption 2 11/13 (size/leading in pt, Regular unless noted). [Using system fonts; Specifications]
9. macOS text styles: Large Title 26/32, Title 1 22/26, Title 2 17/22, Title 3 15/20, Headline 13/16 Bold, Body 13/16, Callout 12/15, Subheadline 11/14, Footnote 10/13, Caption 1 10/13, Caption 2 10/13 Medium (size/line height in pt). [Specifications]
10. Add emphasis with a bolder weight of the same style (for example Body goes Semibold, Titles go Bold) to make an extra level of hierarchy. [Using system fonts; Specifications]
11. Loosen leading for wide columns and long passages; tighten it only to fit a height-limited row, and never tighten it for three or more lines. [Using system fonts]
12. Don't embed the system fonts; ask for them through the system. [Using system fonts]
13. Custom fonts must be legible at the recommended minimum sizes and must support the same accessibility behaviour as system fonts (scaling with text size, Bold Text). [Using custom fonts]
14. The layout must adapt to every text size, including the largest accessibility sizes, and stay readable. [Supporting Dynamic Type]
15. Meaningful icons grow with the text. [Supporting Dynamic Type]
16. Keep truncation to a minimum at large sizes: show as much useful text at the largest accessibility size as at the largest standard size. Don't truncate in scrollable areas unless people can open the full text elsewhere; let labels use as many lines as they need. [Supporting Dynamic Type]
17. At large sizes, stack text above secondary items (icons, timestamps) instead of crowding them on one line, and use fewer columns. [Supporting Dynamic Type]
18. Keep the same information order at every size: primary items stay near the top. [Supporting Dynamic Type]
19. macOS doesn't support Dynamic Type; SF Pro is the system font on iOS, iPadOS and macOS. [Platform considerations]

## How it applies to a web app on iPhone and Mac

- A CSS px is roughly an Apple pt. So body text is 17px on iPhone and 13px on Mac at minimum defaults; nothing goes below 11px on iPhone or 10px on Mac. Note that iOS Safari zooms into any input whose font is under 16px, so form fields need at least 16px there regardless.
- The system font is `font-family: -apple-system, BlinkMacSystemFont, system-ui, sans-serif` (SF Pro on Apple devices). Rule 12 means not shipping SF font files. A web font like Geist is a custom font: rules 2, 3 and 13 apply to it, and stick to one or two families (rule 6).
- iOS Safari offers `font: -apple-system-body` (and `-apple-system-headline`, `-apple-system-footnote`, and so on), which follow the iPhone's Dynamic Type setting. Otherwise, size text in `rem` so browser zoom and Safari's text-size setting scale it.
- Define the text styles once (CSS variables or Tailwind classes, size plus line height plus weight) and use only those, one scale for phone widths and one for desktop widths, taken from rules 8 and 9.
- Rules 14-18 mean testing at 200% zoom on Mac and the largest text size on iPhone: rows grow, text wraps (`overflow-wrap: anywhere` for long names), and `text-overflow: ellipsis` is kept for places where the full text is one tap away.
- Use font-weight 400-700; avoid 100-300 (rule 3).
