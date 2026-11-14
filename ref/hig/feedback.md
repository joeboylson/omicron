# Feedback
Source: https://developer.apple.com/design/human-interface-guidelines/feedback

## In one line
Tell people what's happening, what worked, what failed and what could go wrong, with the interruption sized to how much it matters.

## Rules
1. Match how loud the feedback is to how much it matters: show status quietly so people can look when they want; interrupt only for things like possible data loss. [Introduction]
2. Give feedback in more than one way (for example color plus text, sound or haptics), so people still get it with the sound off, while looking away, or using VoiceOver. [Best practices]
3. Put status next to the thing it describes, so people see it without acting or leaving where they are (like Mail's "updated just now" and unread count in its toolbar). [Best practices]
4. Use an alert only for critical, ideally actionable, information. Alerts used too often or for small things lose their impact. [Best practices]
5. Warn before an action that would lose data unexpectedly and for good. [Best practices]
6. Don't warn when losing data is the expected result of the action (the Finder doesn't warn every time you throw a file away). [Best practices]
7. Confirm that a task finished only when it is important enough (like a payment). People expect things to work; they mostly need to hear when something fails. [Best practices]
8. When a command can't be carried out, show that it can't and say why (Maps says it can't give directions to and from the same place). [Best practices]

## How it applies to a web app on iPhone and Mac
- Never rely on color alone for a state (a red card border also needs a word or icon, and an accessible label for screen readers).
- Show sync and connection state, counts and "last updated" in place (a header, a column, a card), not as pop-ups.
- Save `AlertDialog` for things that can't be undone or are surprising; deleting something the person just chose to delete, with undo available, needs no confirm.
- Skip "Saved" toasts for routine edits; do show a clear message, with the reason, when a change fails or a button can't do its job.
