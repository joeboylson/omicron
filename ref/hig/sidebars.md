# Sidebars
Source: https://developer.apple.com/design/human-interface-guidelines/sidebars

## In one line

A sidebar on the leading side moves between the app's areas or top-level collections; it needs room, so on narrow screens prefer a tab bar, and keep it to two levels, hideable but shown by default.

## Rules

1. A sidebar sits on the leading side and navigates between areas of the app or top-level collections (like folders or playlists); when space is limited, a tab bar may work better. [Sidebars]
2. When possible, let people customize which areas appear in the sidebar and their order. [Best practices]
3. With a lot of content, group hierarchy with disclosure controls to keep the sidebar's height manageable. [Best practices]
4. Consider familiar symbols for sidebar items. [Best practices]
5. Let people hide and show the sidebar with the interactions they know (an edge swipe on iPad; a show/hide button or View menu commands on Mac), but don't hide it by default. [Best practices]
6. Show no more than two levels of hierarchy; for deeper data, use a split view with a content list between the sidebar and the detail view. [Best practices]
7. With two levels, give each group a short, descriptive title, leaving out unnecessary words. [Best practices]
8. Sidebar icons use the app's accent color by default; use fixed colors sparingly and only when they carry meaning (like Mail's yellow VIP icon). [Best practices]
9. On iPhone and iPad, consider a tab bar first; use the tab bar's sidebar-style appearance when there are more areas than fit. [iOS, iPadOS]
10. On Mac, consider hiding the sidebar automatically when the window gets narrow and showing it again when it widens. [macOS]
11. Don't put critical information or actions at the bottom of a sidebar, since the window's bottom edge often ends up hidden. [macOS]

## How it applies to a web app on iPhone and Mac

- shadcn `Sidebar` on Mac widths: on the left, showing by default, collapsible with a button in the header (and a keyboard shortcut).
- At phone width, the sidebar gives way to a bottom tab bar (or opens as a sheet from a button), and collapses on its own when a Mac window gets narrow.
- At most two levels: sections, then Projects within one; a collapsible group header for each section, with a short title.
- The current item stays highlighted; icons are plain (monochrome or accent) with color only where it means something.
- Nothing important (like the sign-in or machine status) lives only at the very bottom of the sidebar.
