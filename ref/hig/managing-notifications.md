# Managing notifications
Source: https://developer.apple.com/design/human-interface-guidelines/managing-notifications

## In one line
Ask first, be honest about how urgent each notification is, and let people change their minds inside the app.

## Rules
1. Get permission before sending any notification; people can change that choice, or silence everything, in system settings. [Introduction]
2. Give each notification an urgency level that fits: Passive (look at it whenever), Active (the default: nice to know when it arrives), Time Sensitive (needs attention now), Critical (health and safety only, very rare, needs an entitlement). [Integrating with Focus]
3. Only Time Sensitive and Critical notifications break through Focus and scheduled summaries; only Critical overrides the Ring/Silent switch. [Integrating with Focus]
4. Build trust by stating each notification's urgency accurately. Never use a high level to interrupt people with something minor. [Best practices]
5. Use Time Sensitive only for things that matter right now: an event happening now or within an hour. [Best practices]
6. Don't send marketing or promotional notifications unless people have explicitly agreed to them. [Sending marketing notifications]
7. Never send a marketing notification as Time Sensitive; it must never break through a Focus or scheduled delivery. [Sending marketing notifications]
8. Ask for marketing permission with an alert or view that says what kinds of things you'll send and gives a clear way to opt in or out. [Sending marketing notifications]
9. Provide a settings screen in the app where people can change their notification choices. [Sending marketing notifications]

## How it applies to a web app on iPhone and Mac
- Ask for browser notification permission only from a clear user action (a "Turn on notifications" switch), with a line saying what will be sent; never on page load.
- Notify only for things that need the person (a task waiting on them, a session asking a question); keep routine changes inside the page.
- Have a notifications section in the app's settings to turn kinds of notifications on and off, separate from the browser's own permission.
- On iPhone, web push only works for a page added to the Home Screen, so the in-app status must still make sense without notifications.
