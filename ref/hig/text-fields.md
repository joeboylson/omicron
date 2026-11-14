# Text Fields
Source: https://developer.apple.com/design/human-interface-guidelines/text-fields

## In one line

A text field takes a small piece of text; label it, size it to the expected text, check what's typed at the right moment, and show the right keyboard.

## Rules

1. Use a text field for a small amount of information, like a name or an email address; for longer text use a text view. [Best practices]
2. Placeholder text ("Email", "Password") can hint at the field's purpose, but it disappears once people type, so a separate label describing the field helps. [Best practices]
3. Always use a secure text field for sensitive data such as a password. [Best practices]
4. Size the field to match how much text you expect. [Best practices]
5. Space multiple fields evenly so each label clearly belongs to its field; stack them vertically where possible, with consistent widths. [Best practices]
6. Tabbing between fields moves focus in a logical order. [Best practices]
7. Validate when it makes sense: an email address when people move to another field, a user name or password before they leave the field; tell people when they type characters a field can't take (like letters in a digits-only field). [Best practices]
8. Use a number formatter for numbers (decimal places, percentage, currency), and don't assume one presentation, since formatting varies by locale. [Best practices]
9. Choose how overflowing text behaves: clip, wrap by character or word, or truncate with an ellipsis at the beginning, middle or end; consider an expansion tooltip on hover to show clipped text in full. [Best practices]
10. On iPhone, iPad, tvOS and visionOS, show the keyboard type that fits the content (numbers, URLs and so on). [Best practices]
11. Show a Clear button at the trailing end of the field so people can erase their input in one tap. [iOS, iPadOS]
12. Use the leading end of the field to show its purpose (an image) and the trailing end for extra features (a button such as Bookmarks). [iOS, iPadOS]
13. On Mac, use a combo box when text input pairs with a list of choices. [macOS]

## How it applies to a web app on iPhone and Mac

- Every shadcn `Input` has a visible `Label`; placeholder text is only a hint, never the label.
- Set `type` and `inputMode` (`email`, `url`, `numeric`, `search`) and `autoComplete` so the iPhone shows the matching keyboard; passwords and keys use `type="password"`.
- Show a validation error after leaving an email-style field (on blur), not on every keystroke; name and password rules are checked before people move on.
- Inputs are at least 16 px text on iPhone (smaller text makes Safari zoom in) and 44 px tall; field widths match expected content and fields stack vertically in a form.
- Long values in a narrow field can truncate with an ellipsis and show the full text in a `title` tooltip on Mac.
- An input that also offers choices from a list is a combo box: shadcn Popover + Command.
