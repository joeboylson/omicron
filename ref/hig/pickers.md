# Pickers
Source: https://developer.apple.com/design/human-interface-guidelines/pickers

## In one line

A picker lets people choose from a scrolling list of predictable, ordered values (often dates and times), shown in place next to the field it sets.

## Rules

1. Use a picker for medium-to-long lists; for a short list use a pull-down button, and for a very large set use a list or table (which can resize and have an index). [Best practices]
2. Order values predictably and logically (for example countries alphabetized), so people can guess the hidden ones. [Best practices]
3. Don't switch views to show a picker; show it in context, below or near the field being edited, usually at the bottom of the window or in a popover. [Best practices]
4. Consider coarser minutes in a time picker, using an interval that divides evenly into 60 (for example 0, 15, 30, 45). [Best practices]
5. The values shown and their order depend on the device's language and location; don't hard-code them. [Pickers; iOS, iPadOS]
6. Date pickers come in compact (a button that opens an editor in a modal view), inline (a calendar, or wheels for time) and wheels styles, in date, time, date-and-time or countdown modes. [iOS, iPadOS]
7. Use a compact date picker when space is tight: a button showing the current value in the app's accent color, which opens a calendar editor; people can make several edits before tapping outside to confirm. [iOS, iPadOS]
8. On Mac, use the textual date picker when space is limited and people pick specific dates and times, and the graphical one (calendar) when people browse days or pick a range. [macOS]

## How it applies to a web app on iPhone and Mac

- A short list of options is a `Select` or `DropdownMenu`; a long list is a searchable Popover + Command; a huge one is a `DataTable`.
- A due-date field is a compact date picker: a button showing the date (or "No Date") that opens shadcn `Calendar` in a `Popover` right beside it, not a new page.
- Time choices can step in 15-minute intervals rather than listing all 60 minutes.
- Format dates and times with the browser's locale (`Intl.DateTimeFormat`), not a fixed pattern.
- Option lists are sorted in an obvious order (alphabetical names, columns in board order).
