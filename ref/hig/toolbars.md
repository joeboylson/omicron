# Toolbars
Source: https://developer.apple.com/design/human-interface-guidelines/toolbars

Apple's navigation bars page now redirects here: on iOS, a toolbar with navigation controls is the navigation bar.

## In one line

A toolbar holds the view's title, navigation (back, search) and its most-used actions, in at most three groups: navigation on the leading edge, common actions in the middle, search and the one primary action on the trailing edge.

## Rules

1. Choose items deliberately so the toolbar isn't crowded and each item is easy to tell apart and hit; decide which items move into overflow as the view narrows. [Best practices]
2. Put less important actions in a More menu, only if really needed. [Best practices]
3. Keep toolbar backgrounds and tinted controls to a minimum, and don't color item labels like a colorful content background; prefer the default monochrome look. [Best practices]
4. Prefer standard components in the toolbar. [Best practices]
5. Give each window a useful title, never the app's name; a word or short phrase under 15 characters. The title can be left empty if it would be redundant. [Titles]
6. Use the standard Back and Close buttons with their standard symbols, not text labels saying "Back" or "Close". [Navigation]
7. Offer the actions that support people's main tasks, prioritizing the ones they most likely want. [Actions]
8. Make each item's meaning clear; prefer simple, recognizable symbols over text, except for actions like Edit that symbols don't show well. Use symbols without borders. [Actions]
9. Give key actions like Done or Submit the prominent style; have only one primary action, on the trailing side. [Actions]
10. Leading edge: back and show/hide-sidebar controls, then the title (and a document menu). Center: common controls. Trailing edge: important always-visible items, inspector buttons, search, the More menu and the primary action. [Item groupings]
11. Group items by function and frequency, put navigation and critical actions (Done, Close, Save) in their own distinct groups, and aim for at most three groups. [Item groupings]
12. Keep groupings and placement the same across platforms. [Item groupings]
13. Separate text-labeled buttons from symbol buttons and from each other with fixed space, so they don't read as one control. [Item groupings]
14. On iPhone, keep only the most important items in the main toolbar and put the rest in a More menu; use a large title that shrinks to a standard title as people scroll. [iOS]
15. On Mac, every toolbar item is also available as a menu bar command, since people can hide or customize the toolbar. [macOS]

## How it applies to a web app on iPhone and Mac

- The page header is the toolbar: back or sidebar toggle and the page title (the Project or page name, not "Omicron") on the left, search and the one primary button (like "New Task") on the right.
- Toolbar actions are icon buttons with tooltips and `aria-label`s, without borders (`variant="ghost"`), each with a 44 px tap area; Edit-like actions can be text.
- At most three groups; when the header gets narrow, lower-priority actions go into a "…" `DropdownMenu`, while the trailing items stay visible.
- Back is a chevron icon, not the word "Back"; Close is an x.
- On iPhone, keep the header to the essentials; a large page title that shrinks on scroll matches iOS.
- Anything in the header can also be reached another way (a keyboard shortcut or the command palette), so hiding the header never hides a command.
