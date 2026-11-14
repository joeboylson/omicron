# Writing

Source: https://developer.apple.com/design/human-interface-guidelines/writing

## In one line

Use few, plain, consistent words; label actions with verbs; and make errors, empty screens and settings tell people exactly what to do next.

## Rules

1. Decide the app's voice and keep a list of common terms; use that list so the same thing always has the same name. [Getting started]
2. Match the tone to the situation: plain and direct for errors and serious moments, lighter for successes. [Getting started]
3. Be clear: check each word is needed, use fewer words when you can, and read it out loud when unsure. [Getting started]
4. Write for everyone: simple, plain language, written with accessibility and translation in mind; no jargon, no gendered terms. [Getting started]
5. Put the most important information first on each screen; if there's more than one idea, consider splitting it across screens. [Best practices]
6. Label buttons and links with verbs, in active voice, and don't be cute ("Send", not "Let's do it!"). Links say where they go, never "Click here". [Best practices]
7. Build repeatable language patterns and reuse them. [Best practices]
8. Choose a capitalisation style for each kind of element (for example title case for all alerts, sentence case for all headings) and apply it everywhere. [Best practices]
9. In multi-step flows, use consistent action labels: something like "Get Started" to begin, then always "Continue" or always "Next" (or a label hinting at the next step), and "Done" at the end. [Best practices]
10. Use "my" and "your" sparingly ("Favorites", not "Your Favorites"); if you use them, stay consistent and don't switch perspective. Never use "we" ("Unable to load content", not "We're having trouble loading this content"). [Best practices]
11. Describe gestures correctly for each device: "tap" on iPhone and iPad, not "click". Small screens need short text. [Best practices]
12. Every empty screen says what to do next, with a button or link to do it where possible. Don't put crucial information in an empty state, since it disappears. [Best practices]
13. Error messages appear next to the problem, don't blame, and say how to fix it ("Choose a password with at least 8 characters", not "That password is too short"). Skip "oops" and "uh-oh". If wording can't fix a common error, rethink the interaction. [Best practices]
14. Pick the delivery method (notification, alert, action sheet) by how urgent and important the message is. [Best practices]
15. Label settings plainly; if the label isn't enough, describe what it does when on (people infer off). To send someone to a setting, give a direct link or button instead of describing where it is. [Best practices]
16. Label every text field and use placeholder or hint text to show the format ("name@example.com" or "Your name"). Show field errors right beside the field, saying how to enter it correctly ("Use only letters for your name", not "Invalid name" or "Don't use numbers or symbols"). [Best practices]

## How it applies to a web app on iPhone and Mac

- Rule 1 is Omicron's `DEFINITIONS.txt`: every label, button and message uses those names and no others.
- Rule 11 matters because the same page runs on iPhone and Mac: prefer words that suit both ("select", "open", "choose") or none at all, rather than "click" or "tap".
- Rule 8: pick one case per element type (for example sentence case for headings, buttons and menu items) and use it in every shadcn component, including dialog titles and toasts.
- Rule 13 and 16 on the web: show a failed save or invalid field inline next to the control (form message under the field), not only in a toast.
- Rule 15: a link that opens the exact settings page or section, not "go to Settings and find...".
- Rule 12: empty board columns, empty search results and empty lists each get one short line and, where it makes sense, the button that fills them.
