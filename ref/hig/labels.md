# Labels
Source: https://developer.apple.com/design/human-interface-guidelines/labels

## In one line

A label is text people read (and often copy) but don't edit; keep it short, legible in system fonts, ranked by the four label colors, and selectable when it's useful.

## Rules

1. Use a label for a small amount of text people don't need to edit; for small editable text use a text field, and for a large amount of text a text view. [Best practices]
2. Prefer system fonts; if you restyle a label or use a custom font, keep it legible. Labels support Dynamic Type by default where available. [Best practices]
3. Show relative importance with the four system label colors: label for primary information, secondary for subheadings or supplemental text, tertiary for text describing an unavailable item or behavior, quaternary for watermark text. [Best practices]
4. Make useful label text selectable, such as an error message, a location or an IP address, so people can copy and paste it. [Best practices]
5. In a button, a label says what the button does (Edit, Cancel, Send); in a list, it describes each item, often with a symbol or image; in a view, it can introduce a control or describe a task. [Labels]

## How it applies to a web app on iPhone and Mac

- Use the theme's text colors as the four levels: `foreground` for primary text, `muted-foreground` for secondary, a dimmer shade for unavailable items; don't invent extra greys.
- Keep text selectable (no `select-none`) on values people may copy: error messages, session and task IDs, branch names, hostnames, IP addresses; offer a copy button for long ones.
- Text sizes follow the browser's text-size setting (use `rem`), the web's version of Dynamic Type.
- Form labels are shadcn `Label`s tied to their inputs, not placeholder text.
