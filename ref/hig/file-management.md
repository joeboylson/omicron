# File management
Source: https://developer.apple.com/design/human-interface-guidelines/file-management

## In one line
Keep people's work saved without them thinking about it, and let them preview files even when the app can't open them.

## Rules
1. Give convenient ways to create and open things with menu commands and keyboard shortcuts (New, Open), and always include an Add (+) button for creating something new. [Creating and opening files]
2. A custom file browser should match how people already understand the file system, opening on the most relevant place (like the last location) while still letting them see the rest. [Creating and opening files]
3. Make people confident their work is kept unless they cancel or delete it: don't make them save explicitly; save automatically as they edit and when they close or switch away. [Saving work]
4. Hide file extensions by default, but let people show them, and reflect that choice everywhere. [Saving work]
5. Let people preview a file inside the app (Quick Look) even when the app can't open it, for example attachments. [Quick Look previews]
6. On Mac, make custom open interfaces convenient: an "open recent" action, filters, opening several at once, and an Open button named for the task (like Insert). [Platform considerations, macOS]
7. On Mac, a new document is called "Untitled" until people name it. [Platform considerations, macOS]
8. If autosave is off, show when there are unsaved changes (a dot on the close button) and ask to save before closing. When autosave is on, don't show that dot; an "Edited" note in the title is fine but remove it as soon as the save happens. [Platform considerations, macOS]

## How it applies to a web app on iPhone and Mac
- Save text and field edits as people type or on blur, with no Save button, and keep an unsent draft if the page closes; never leave a "you have unsaved changes" state unless saving failed, and then say so plainly.
- Offer a "+" button for creating tasks and Projects, plus a keyboard shortcut on Mac.
- Attached files and screenshots open in an in-page preview (a lightbox for images), with a download link for anything that can't preview.
