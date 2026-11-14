# Entering data
Source: https://developer.apple.com/design/human-interface-guidelines/entering-data

## In one line
Ask for as little as possible, make clear what you need, and catch mistakes as people type.

## Rules
1. Gather as much as you can ahead of time so people have less to type, and support every input method so people can use the one that suits them. [Introduction]
2. Don't ask for information you can get from the system (settings) or with permission (location, calendar). [Best practices]
3. Be clear about what you need: a prompt in the field (like "username@company.com") or a label before it (like "Email"). [Best practices]
4. Prefill fields with sensible defaults to cut down on decisions and speed up entry. [Best practices]
5. Use a secure field that hides each character for sensitive data. [Best practices]
6. Never prefill a password field; ask for the password or use biometric or keychain sign-in. [Best practices]
7. Offer choices instead of typing where you can: a picker, menu or other selection control is usually easier than a text field, even with a keyboard at hand. [Best practices]
8. Let people supply data by dragging and dropping or pasting it. [Best practices]
9. Check values as soon as they are entered and say so the moment there's a problem, instead of after a long form. For numbers, accept only numeric input and format the value (decimal places, percent, currency). [Best practices]
10. Make it clear that required data must be given before going on: for example, enable Next or Continue only once the required fields are filled. [Best practices]
11. On Mac, consider an expansion tooltip that shows the full text of a field when it's cut off, appearing when the pointer rests on it. [Platform considerations, macOS]

## How it applies to a web app on iPhone and Mac
- Fill in what the app knows (current Project, the signed-in person, today's date) and use selects, comboboxes and pickers over free text for things like members, labels and columns.
- Use the right `type`, `inputmode` and `autocomplete` on inputs so iPhone shows the right keyboard and offers autofill; use `type="password"` for secrets and never fill one in.
- Validate on blur or as people type, with the error shown under the field, and keep the submit button disabled until required fields are filled.
- Accept pasted text and dropped files or links into fields where it makes sense; on Mac, give truncated values a `title` tooltip with the full text.
