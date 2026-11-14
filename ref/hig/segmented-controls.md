# Segmented Controls
Source: https://developer.apple.com/design/human-interface-guidelines/segmented-controls

## In one line

A segmented control is a row of equal-width segments for picking between a few closely related options (or views), with the current choice plainly shown.

## Rules

1. Use a segmented control for closely related choices that affect an object, state or view. [Best practices]
2. Consider one when grouping matters or when the selection state needs to be clear at a glance. [Best practices]
3. Keep one kind of control: either every segment shows a selection, or every segment performs an action, never a mix. [Best practices]
4. Limit segments to about five to seven in a wide interface and about five on iPhone. [Best practices]
5. Keep segments the same width, and icon and title widths consistent where possible. [Best practices]
6. Use text or images in a control, not a mix of both. [Content]
7. Use content of similar size in each segment. [Content]
8. Label segments with nouns or noun phrases in title-style capitalization; a text segmented control needs no introductory text. [Content]
9. On iPhone and iPad, use it to switch between closely related subviews; to switch between completely separate sections of the app, use a tab bar. [iOS, iPadOS]
10. On Mac, for switching views in the main window area use a tab view; segmented controls suit view switching in a toolbar or inspector. Give each segment a tooltip if the app uses tooltips. [macOS]
11. On Mac, icon segments can have introductory text or a label below each segment to explain them. [macOS]

## How it applies to a web app on iPhone and Mac

- shadcn `ToggleGroup type="single"` (or `Tabs` with a `TabsList`) is the segmented control; all segments the same width.
- Use it for related views of the same thing (like Board / List of one Project's tasks), not for moving between unrelated pages, which is the sidebar's or tab bar's job.
- At most about five segments on the phone; past that, use a `Select`.
- Labels are short Title Case nouns ("Board", "List"), all text or all icons; icon-only segments get a tooltip and `aria-label`.
- Each segment's tap area is at least 44 px tall on the phone.
