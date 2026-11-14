# Going full screen
Source: https://developer.apple.com/design/human-interface-guidelines/going-full-screen

## In one line
Offer full screen where focus helps, keep the needed controls reachable, and let people decide when to go in and out.

## Rules
1. Support full screen when it helps: games, media like videos or photo slideshows, or an in-depth task that benefits from no distractions. [Best practices]
2. In full screen you may adjust the layout to use the extra space (proportions, not which items appear), subtly, without jarring changes; don't resize the window yourself. [Best practices]
3. Keep essential features and controls available so people can finish the task without leaving full screen (for example, media controls always shown or easy to bring back). [Best practices]
4. Except in games, let people reach the Dock while the app is full screen. [Best practices]
5. When people switch away and come back, let them resume where they were; pause things like slideshows automatically. [Best practices]
6. Let people choose when to leave full screen; don't end it automatically when they switch away or finish something. [Best practices]
7. You can hide toolbars and navigation while content is the focus, but bring them back with a familiar action (tap, swipe down, move the pointer to the top) and keep controls that are essential to navigating or working visible. [Best practices]
8. On Mac, use the system's full-screen support, and let people choose when to enter it (the window's Enter Full Screen button, the View menu, or Control-Command-F); avoid a custom menu of window modes. [Platform considerations, macOS]

## How it applies to a web app on iPhone and Mac
- Only a few views are worth a full-screen option, like viewing a screenshot or image attached to a task; use the browser's Fullscreen API from a button the person presses, never automatically.
- In such a view keep the close button and next/previous controls visible or one tap away, and let Escape exit.
- Don't fight the browser's own full screen (Control-Command-F on Mac): the layout just gets more room.
