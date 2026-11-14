# Search Fields
Source: https://developer.apple.com/design/human-interface-guidelines/search-fields

## In one line

A search field (search icon, Clear button, placeholder) searches as people type, puts the best results first, and sits where its scope is obvious: the toolbar, the top of a sidebar, or inline above the list it filters.

## Rules

1. Use placeholder text to say what people can search for. [Best practices]
2. If possible, start searching as soon as people type, refining results with each character. [Best practices]
3. Consider showing suggested search terms: recent searches before typing, predictions while typing. [Best practices]
4. Show the most relevant results first, and consider grouping them into categories. [Best practices]
5. Consider letting people filter results, for example with a scope bar in the results area. [Best practices]
6. Use a scope bar to filter among clearly defined categories, defaulting to the broader scope and letting people narrow it. [Scope bars and tokens]
7. Use tokens (a search term shown as one selectable, editable item) to filter by common terms or items, and pair them with suggestions so people learn which tokens exist. [Scope bars and tokens]
8. On iPhone, search can be a tab in the tab bar, a field or button in a top or bottom toolbar, or a field inline with content; choose by layout and navigation. [iOS]
9. On iPhone, put search at the bottom when there's room and search is a priority; put it at the top when content at the bottom must stay uncovered or there's no bottom toolbar. [iOS]
10. Place an inline search field next to the content it searches, so it's clear it applies to that view; at the top, put it above the list it filters and consider pinning it to the top toolbar while scrolling. [iOS]
11. On iPad and Mac, put the search field at the trailing side of the toolbar for common uses, such as searching across a split view's columns or filtering the detail view. Keep search consistent between iPad and Mac. [iPadOS, macOS]
12. Put search at the top of the sidebar when it filters the sidebar's content or navigation. [iPadOS, macOS]
13. Use a dedicated search area (an item in the sidebar or tab bar) when search comes with rich suggestions or categories; focus its field right away when people go there, except on iPad with only an on-screen keyboard. [iPadOS, macOS]
14. When the window gets narrow, keep search where it's most useful, for example above the content list's column. [iPadOS, macOS]

## How it applies to a web app on iPhone and Mac

- A search box is an `Input type="search"` with a search icon at the leading end, a Clear (x) button at the trailing end once there's text, and placeholder text naming what it searches ("Search tasks").
- Filter as people type (debounced), with no Search button to press; `DataTable`'s search already works this way.
- On Mac, the page-wide search sits at the trailing end of the top bar; a search that filters one list sits directly above that list.
- On iPhone, keep search reachable near the bottom when it's a main way in, or above the list it filters when it's local; don't let the keyboard cover the results.
- Filters such as label or member chips act as tokens or a scope bar; default to the broadest scope (all tasks).
- Show recent or suggested searches in the empty state; a command palette (shadcn `Command`) can group results by kind.
