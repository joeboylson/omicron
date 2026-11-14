# Dark Mode

Source: https://developer.apple.com/design/human-interface-guidelines/dark-mode

## In one line

Follow the system's light or dark setting (no separate app setting), and make every colour, icon and text stay legible in both, using colours that adapt rather than fixed values.

## Rules

1. Don't offer an app-only appearance setting. People expect the app to follow their system choice; a separate switch is extra work and makes the app look broken when it ignores the system. [Best practices]
2. Look good in both appearances, and handle Auto, which switches between light and dark during the day, possibly while the app is open. [Best practices]
3. Test legibility in Dark Mode with Increase Contrast and Reduce Transparency turned on, separately and together; watch for dark text on dark backgrounds. [Best practices]
4. Only in rare cases (such as immersive media viewing) use a permanently dark interface. [Best practices]
5. Dark colours aren't simply inverted light colours: backgrounds are dimmer and foregrounds brighter, and some colours don't invert at all. [Dark Mode colors]
6. Use colours that adapt to the appearance (semantic colours); for custom colours define a light and a dark variant. Don't hard-code colour values or use colours that don't adapt. [Dark Mode colors]
7. Keep contrast at least 4.5:1 in every appearance; for custom foreground and background colours aim for 7:1, especially for small text. [Dark Mode colors]
8. Slightly darken content images with white backgrounds so they don't glow in Dark Mode. [Dark Mode colors]
9. Prefer symbol icons tinted with adaptive colours; they work in both appearances. [Icons and images]
10. Make separate light and dark icons when needed (for example a subtle outline that only the light version needs, or a border so an edge shows on dark). [Icons and images]
11. Full-colour images and icons must look good in both appearances; if one doesn't, change it or provide light and dark versions. [Icons and images]
12. Use the primary, secondary, tertiary and quaternary label colours for text; they adapt automatically. [Text]
13. Use system text fields and text views rather than drawing text yourself. [Text]
14. In Dark Mode, use the "base" background for what's behind and the brighter "elevated" background for what's in front (popovers, sheets), so layers read as depth. Prefer the system backgrounds so this happens automatically. [iOS, iPadOS]
15. On a Mac with desktop tinting, custom components with a visible background may use some transparency, but only in a neutral (uncoloured) state. [macOS]

## How it applies to a web app on iPhone and Mac

- Follow `prefers-color-scheme` and nothing else (rule 1): no light/dark toggle in the app. Listen for changes with `matchMedia('(prefers-color-scheme: dark)')` so Auto switching mid-session updates the page (rule 2).
- Add `<meta name="color-scheme" content="light dark">` (or CSS `color-scheme: light dark`) so Safari's native scrollbars, form controls and the page background match before the CSS loads.
- Keep shadcn's light and dark CSS variable sets; the dark set is tuned, not inverted (rule 5). Check each text-on-background pair reaches 4.5:1, aiming for 7:1 on small text (rule 7).
- Rule 14 on the web: popovers, dialogs and sheets use a slightly lighter surface (`--popover`, `--card`) than the page background in dark mode, rather than shadows alone, which barely show on dark.
- Test with `prefers-contrast: more` and `prefers-reduced-transparency: reduce` turned on in both themes (rule 3); give translucent or blurred surfaces a solid fallback.
- Set `<meta name="theme-color">` with a `media` attribute for each scheme so Safari's toolbar tint matches.
- Images and screenshots with white backgrounds can take `filter: brightness(.9)` in dark mode (rule 8); SVG icons use `currentColor` (rule 9).
