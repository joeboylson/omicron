# Modality
Source: https://developer.apple.com/design/human-interface-guidelines/modality

## In one line
Use a modal view only when it clearly helps, keep it short, name its task and always make it easy to close.

## Rules
1. Use modal views for: critical information people must see or act on, confirming or changing their last action, a distinct narrow task without losing their place, or focusing on a complex task. [Introduction]
2. Present content modally only when there's a clear benefit, since it takes people out of their context and needs an action to dismiss. [Best practices]
3. Keep modal tasks simple, short and streamlined, so people don't lose track of what they left. [Best practices]
4. Don't make a modal feel like an app inside the app. If it needs subviews, give one path through them, and no buttons that look like the dismiss button. [Best practices]
5. Consider a full-screen modal for in-depth content or a complex multistep task (video, photos, markup, editing). [Best practices]
6. Always give an obvious way to close a modal, following platform habits: on iPhone a button in the top toolbar or a swipe down; on Mac a button in the main content. [Best practices]
7. If closing could lose what people made, whether by button or gesture, explain that and give ways to resolve it, like a Save option. [Best practices]
8. Give the modal a title that names its task (and, if needed, text describing it) so people keep their place. [Best practices]
9. Let people close one modal before showing another; don't stack modal views. An alert may appear over anything, but never show more than one alert at a time. [Best practices]

## How it applies to a web app on iPhone and Mac
- Prefer editing in place or in a side panel over a dialog; use `Dialog` / `Sheet` for short, single-purpose tasks and `AlertDialog` for things that can't be undone.
- Every dialog has a title naming the task, closes with Escape and a visible close or Cancel button on Mac, and on iPhone a bottom sheet also closes by swiping down.
- If a dialog holds unsaved typing, ask before closing it (Save, Discard, Keep editing), or keep the draft.
- Don't open a dialog from a dialog; finish or close the first, or switch its content in place.
