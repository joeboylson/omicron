# Materials

Source: https://developer.apple.com/design/human-interface-guidelines/materials

## In one line

Translucent, blurred layers separate floating controls from the content under them; use them sparingly, only for controls and navigation, and keep text on them legible.

## Rules

1. Materials separate foreground (text, controls) from background (content, solid colours) by letting some background colour show through. [Overview]
2. Liquid Glass is a separate layer for controls and navigation (tab bars, sidebars, toolbars) that floats above content; content scrolls and peeks through underneath. [Liquid Glass]
3. Don't use Liquid Glass in the content layer itself (app backgrounds, content cards); use standard materials there. Exception: a slider or toggle may look like glass briefly while being used. [Liquid Glass]
4. Use glass effects sparingly on custom controls; keep them to the most important functional elements, since overuse distracts from content. [Liquid Glass]
5. Use the regular (blurred, luminosity-adjusted) variant when background content could hurt legibility or the component holds a lot of text, such as alerts, sidebars and popovers. [Liquid Glass]
6. Use the highly translucent clear variant only over visually rich backgrounds like photos and video. [Liquid Glass]
7. Over bright content, put a dark dimming layer of 35% opacity behind clear glass; over dark content no dimming layer is needed. [Liquid Glass]
8. Appearance changes with system settings such as Reduce Transparency and Increase Contrast. [Liquid Glass]
9. Choose a material for its meaning and intended use, not for the colour it seems to give, since settings change its look. [Standard materials]
10. Use vibrant (system-defined) colours for text and fills on top of materials to keep contrast right. [Standard materials]
11. Thicker, more opaque materials give better contrast for text and fine detail; thinner, more translucent ones keep more sense of the content behind. [Standard materials]
12. iOS offers four standard materials (ultra-thin, thin, regular as default, thick). Label vibrancy levels run label (highest contrast), secondary, tertiary, quaternary; avoid quaternary on thin and ultra-thin materials because contrast is too low. [iOS, iPadOS]
13. On a Mac, test vibrancy in custom views across contexts and use it where it helps; pick a blending mode (behind window or within window) that suits the design. [macOS]

## How it applies to a web app on iPhone and Mac

- The web equivalent is a semi-transparent background plus `backdrop-filter: blur(...)` (with `-webkit-backdrop-filter` for Safari). Keep it to floating chrome: a sticky header, a bottom bar on iPhone, popovers and sheets (rules 2-4). Cards and columns on the board stay solid.
- Prefer the "regular" kind for anything with text (rule 5): enough blur and opacity that text over a busy board stays readable; check contrast against the busiest content that can scroll under it (rules 10-11).
- Under `@media (prefers-reduced-transparency: reduce)` and `(prefers-contrast: more)`, swap blur for a solid background (rule 8).
- A dimmed backdrop behind dialogs and sheets over bright content can use about 35% black (rule 7).
- Secondary and muted text on a translucent surface needs more contrast than on a solid one; avoid the faintest grey on thin translucent bars (rule 12).
