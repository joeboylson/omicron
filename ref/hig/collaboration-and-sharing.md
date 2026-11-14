# Collaboration and sharing
Source: https://developer.apple.com/design/human-interface-guidelines/collaboration-and-sharing

## In one line
Make sharing easy to start, permissions easy to read, and always show who else is in shared content.

## Rules
1. Put the Share button somewhere handy, like the toolbar, so people can easily start sharing or collaborating. [Best practices]
2. Where it fits, let people send a copy as well as invite collaborators. [Best practices]
3. Sum up the sharing permissions in a short phrase, like "Only invited people can edit" or "Everyone can make changes". [Best practices]
4. Offer a small set of simple sharing options: who can access it, whether they can edit or only read, and whether collaborators can add people. Keep custom choices few and grouped so they read at a glance. [Best practices]
5. Once collaboration starts, show a prominent Collaboration button, next to the Share button, that reminds people the content is shared and shows who is sharing it. [Best practices]
6. In the collaboration popover, list collaborators with ways to contact them, then only the most essential custom items (like a summary of recent updates), then a button to manage sharing. [Best practices]
7. Give the management button a fitting title if needed (default "Manage Shared File"); it opens a view to change settings and add or remove collaborators. [Best practices]
8. Consider notifying people of collaboration events (content changes, people joining or leaving, a mention), with a link that opens the relevant view. [Best practices]
9. Support universal links so shared links open the right place in the app. [Introduction]

## How it applies to a web app on iPhone and Mac
- On a Project page, show its members as an avatar group in the header next to a Share or Members button; that is the "who's in this" reminder.
- Describe access in one plain line ("Members can edit") and keep the options to a few: who, and whether they can edit.
- Every task and Project has a stable URL that opens it directly, and a Copy link action; on iPhone use the Web Share API (`navigator.share`) for the system share sheet.
- Mentions, joins and changes can feed the person's notifications, each linking straight to the item.
