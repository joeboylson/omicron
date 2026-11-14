# Offering help
Source: https://developer.apple.com/design/human-interface-guidelines/offering-help

## In one line
Make the app clear enough to need little help, and when help is needed, keep it short, in context and easy to dismiss.

## Rules
1. Fit the help to the task: a short inline view for simple one- or two-step tasks, a tutorial for complex multistep goals. [Best practices]
2. Tie help to exactly what people are doing right now, and make it easy to dismiss or avoid. [Best practices]
3. Use words and images that fit the context and the platform: don't say "click" on iPhone or "tap" on Mac. [Best practices]
4. Make all help content inclusive. [Best practices]
5. Don't explain how standard controls work; explain what a standard control does in your app. For a unique control, orient people quickly, preferring animation or graphics to long text. [Best practices]
6. Use tips (small, passing views) for new or less obvious features, or faster ways to do a task: a popover tip to keep the content flow, or an inline tip to keep surrounding information visible. [Creating tips]
7. Use tips only for simple features; more than three actions is probably too much for a tip. [Creating tips]
8. Keep a tip to one or two short, direct, action-led sentences, with nothing promotional or about another feature. [Creating tips]
9. Show tips only to people who would benefit (not to those who already use the feature), and space several tips out, for example once every 24 hours. [Creating tips]
10. Use a button in a tip to take people to the related settings or to more information. [Creating tips]
11. Tooltips (on Mac, on pointer hover) describe only the control being pointed at, start with a verb ("Restore default settings"), don't repeat the control's name, and stay within about 60 to 75 characters. [macOS, visionOS]
12. Write tooltips in sentence case, without a closing period on full sentences unless your style needs it; consider different text for a control's different states. [macOS, visionOS]

## How it applies to a web app on iPhone and Mac
- Give icon-only buttons a tooltip on Mac (shadcn `Tooltip`) that says what they do, starting with a verb; on iPhone, where there is no hover, the same text must be the button's accessible label, and the meaning must be clear without it.
- Write "click" and "tap" correctly for the device, or use neutral words like "choose".
- A first-time hint for a less obvious gesture (press and hold to drag, swipe between columns) can be a small dismissible inline tip shown once, not a help page.
- Don't explain ordinary controls (checkboxes, menus, search fields).
