# Onboarding
Source: https://developer.apple.com/design/human-interface-guidelines/onboarding

## In one line
Ideally the app explains itself; if it needs onboarding, make it short, hands-on and optional.

## Rules
1. Teach by letting people do the thing, safely, rather than showing instructions. [Best practices]
2. Prefer a set of small tips that appear in context over one big onboarding flow, and show each tip next to the part of the screen it is about. [Best practices]
3. If onboarding must come first, keep it brief and enjoyable, and don't ask people to memorize much. [Best practices]
4. Make a separate tutorial optional. If someone skips it, don't show it again on later launches, but keep it easy to find later (for example in help, account or settings). [Best practices]
5. Teach your app, not how to use the system or the device. [Best practices]
6. If you need a splash screen, show it only long enough to take in at a glance. [Additional content]
7. Don't make people wait for large downloads before they can start. [Additional content]
8. Keep licensing details out of onboarding; if you must include them, do it without disrupting the flow. [Additional content]
9. Put off setup and customization that isn't essential; ship sensible defaults so most people can start right away. [Additional requests]
10. Ask for permission to private data or resources during onboarding only if the app can't work without it, explaining why; otherwise ask when people first use the feature that needs it. [Additional requests]
11. Let people use the app before asking for ratings or purchases. [Additional requests]

## How it applies to a web app on iPhone and Mac
- A new person should land on a working page with sensible defaults, not a setup wizard; let them do real things (make a task, drag a card) straight away.
- Use empty states and small inline hints placed where the action is, instead of a tour of overlays.
- Ask for browser permissions (notifications and the like) only when someone turns on the feature that needs them, never on first load.
- If there is a tour, it is skippable, never comes back on its own, and can be reopened from help or settings.
