# Settings
Source: https://developer.apple.com/design/human-interface-guidelines/settings

## In one line
Good defaults first, few settings, task options where the task is, and settings opened the way people expect.

## Rules
1. Choose defaults that give the best experience to the most people, so most never need to change anything before starting. [Best practices]
2. Keep the number of settings small; too many makes the app feel less approachable and makes any one setting hard to find. [Best practices]
3. Open settings the way people expect: with a keyboard, the standard Command-Comma; in games, often Escape. [Best practices]
4. Don't use settings to ask for things you can detect, like whether people are in Dark Mode. [Best practices]
5. Respect systemwide settings (accessibility, scrolling, authentication) and don't copy them into your own settings. [Best practices]
6. Put general settings that people rarely change in the app's settings area (window layout, account options). [General settings]
7. Put task-specific options (show or hide parts of a view, reorder items, filter a list) on the screen they affect, not in settings. [Task-specific options]
8. On Mac, put Settings in the App menu, not as a button in a window's toolbar; document-level options go in the File menu. [Platform considerations, macOS]
9. On Mac, a settings window uses a fixed toolbar of panes that always shows which pane is active, titles itself after the visible pane (or "App Name Settings" with one pane), and reopens on the last pane viewed. [Platform considerations, macOS]

## How it applies to a web app on iPhone and Mac
- Follow the system light or dark mode (`prefers-color-scheme`), reduced motion and text size without asking, and don't add in-app copies of those settings.
- Keep view options (filters, sort, which columns show, grouping) on the board or table itself, not on a settings page.
- Have one settings page, reachable from the account menu and with Command-Comma on Mac, grouped into a few sections with the current section shown in the nav and the URL, so it reopens there.
- Keep that page short; each setting needs a reason to exist.
