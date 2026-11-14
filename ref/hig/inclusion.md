# Inclusion

Source: https://developer.apple.com/design/human-interface-guidelines/inclusion

## In one line

Write plainly and respectfully, assume nothing about who people are or what they've lived, represent people fairly, and make everything accessible and ready for other languages.

## Rules

1. Check the tone of copy from different perspectives; be clear, direct and respectful (an academic tone, for example, can seem to welcome only the highly educated). [Welcoming language]
2. Address people as "you" and "your", not "the user" or "the player". Keep "we" and "our" for the software or company. [Welcoming language]
3. Don't use specialised or technical terms without defining them first and making the definition easy to find; prefer plain language. [Welcoming language]
4. Replace colloquial expressions with plain language; they're hard to translate and some have exclusionary origins (for example "peanut gallery", "grandfathered in"). [Welcoming language]
5. Think carefully before using humour; it's subjective, hard to translate and can wear thin or offend. [Welcoming language]
6. Present a clear, straightforward interface that fits the platform, so no special skills are needed to start. [Being approachable]
7. Build in ways to learn the app, such as step-by-step onboarding that people can skip. [Being approachable]
8. Avoid unnecessary references to gender in copy ("Subscribers can post recipes", not "a subscriber ... his or her recipes"). [Gender identity]
9. Use non-gendered images for a generic person, and let people customise avatars and characters. [Gender identity]
10. Don't ask for gender unless it's needed; if it is, include options like nonbinary, self-identify and decline to state, and consider asking for pronouns. [Gender identity]
11. Portray a range of people and avoid stereotypes in occupations and roles; show settings and objects most people find familiar. [People and settings]
12. Don't build features on assumptions that not everyone shares (a narrow definition of family; security questions like "make of your first car"); use more universal experiences. [Avoiding stereotypes]
13. Support the system accessibility features (VoiceOver, Display Accommodations, captions, Switch Control, Speak Screen), and don't assume a disability means someone won't want to use the app. [Accessibility]
14. Don't use disability to express a negative quality; write people-first, and use how a person or community self-identifies. [Accessibility]
15. Prefer familiar, consistent interactions, and make content perceivable by sight, hearing or touch. [Accessibility]
16. Support other languages and regions: translated text, and local formats for dates, times and money. [Languages]
17. Check that colours mean the same thing in every locale (white means death or grief in some places, purity in others). [Languages]

## How it applies to a web app on iPhone and Mac

- Rules 2-3: Omicron's copy says "you", and any Omicron-specific word (Project, handoff, Machine, Team) is defined in `DEFINITIONS.txt` and used the same way everywhere.
- Rule 16 in the browser: format dates, times and numbers with `Intl.DateTimeFormat` / `Intl.NumberFormat` / `Intl.RelativeTimeFormat` using the browser's locale rather than hand-built strings; set `<html lang>`.
- Avatars and member pictures default to initials or a neutral figure, not gendered images (rule 9).
- Rules 13 and 15 point to accessibility.md: semantic HTML and ARIA so VoiceOver on iPhone and Mac can read and operate the page.
- Rule 17: status colours keep a word or icon beside them, so meaning doesn't depend on a colour's cultural reading.
