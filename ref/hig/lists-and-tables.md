# Lists and Tables
Source: https://developer.apple.com/design/human-interface-guidelines/lists-and-tables

## In one line

Lists and tables show rows of short, scannable text; give clear feedback on selection, Title Case noun column headings, and on Mac, sortable and resizable columns.

## Rules

1. Prefer text in lists and tables; for items that vary a lot in size or many images, use a collection instead. [Best practices]
2. Let people edit a list when it makes sense; people like to reorder even when they can't add or remove. On iPhone and iPad, selecting items needs an edit mode. [Best practices]
3. Give feedback on selection: a list for moving through a hierarchy keeps the selected row highlighted; a list of options highlights briefly, then shows a checkmark. [Best practices]
4. Keep item text short to avoid truncation and wrapping; for long items show titles only and open the full content in a detail view. [Content]
5. Keep text readable when a table gets narrow; an ellipsis in the middle can keep both the start and end of an item recognizable. [Content]
6. Column headings in a multicolumn table are nouns or short noun phrases in title-style capitalization, with no ending punctuation; a single-column list without a heading gets a label or header for context. [Content]
7. Choose a table style that fits the data: grouped (headers, footers and space between groups) on iPhone and iPad, bordered with alternating row backgrounds on Mac. [Style]
8. Choose a row style that fits the content, such as a small image at the leading end followed by a short label. [Style]
9. Use an info (detail disclosure) button only to show more about a row; to drill into a row, use a disclosure indicator (chevron). [iOS, iPadOS, visionOS]
10. Don't add an alphabet index to a table that has controls at the trailing end of its rows. [iOS, iPadOS, visionOS]
11. Let people click a column heading to sort by it, and click again to reverse the order. [macOS]
12. Let people resize columns. [macOS]
13. Consider alternating row colors in a wide multicolumn table. [macOS]
14. Show hierarchical data in an outline view, with disclosure triangles for nested levels. [macOS]

## How it applies to a web app on iPhone and Mac

- Every table is `components/DataTable`: headings are Title Case nouns ("Title", "Due Date"), click to sort, click again to reverse, with a sort arrow showing the direction.
- On the phone, a wide table becomes a list of rows showing only the key text, with a chevron when a row opens a detail page; long text goes in the detail view, not the row.
- The selected row in a list that leads somewhere (like a sidebar or master list) stays highlighted; a pick-one list shows a checkmark.
- Rows are at least 44 px tall on the phone; truncate long text with an ellipsis, in the middle for names like file paths or branch names.
- Grouped content uses section headers (shadcn `Table` with header rows, or `Card`s per group); nested data uses expand/collapse rows, not indentation alone.
- Reordering (drag and drop) is welcome where order matters, like board columns.
