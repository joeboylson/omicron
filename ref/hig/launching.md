# Launching
Source: https://developer.apple.com/design/human-interface-guidelines/launching

## In one line
Open fast and pick up exactly where people left off.

## Rules
1. Launch instantly. People want to start right away and sometimes won't wait more than a couple of seconds. [Best practices]
2. If you need a splash screen (a branding graphic), show it at the start of onboarding, or right after launch if there is no onboarding, not as part of launch itself. [Best practices]
3. When the app restarts, restore its previous state so people carry on where they left off, without retracing steps. [Best practices]
4. Restore fine details too: scroll back to the last position, and put windows back in the same state and place. [Best practices]
5. If you show something during launch, keep it almost identical to the first screen, so there is no jarring flash when the real screen appears; if the app shows a solid color first, show only that color. Match the device's orientation and light or dark appearance. [Launch screens]
6. Don't put text, ads, logos or branding on that launch view unless they are a fixed part of the first screen. Its only job is to make the app feel quick. [Launch screens]
7. Launch in the device's current orientation if the app supports both portrait and landscape. [Platform considerations, iOS, iPadOS]

## How it applies to a web app on iPhone and Mac
- The HTML shell should paint the real page frame fast, in the right light or dark theme, so there is no white flash before the app loads (set the background color in the first CSS, and `theme-color`).
- Skip splash screens and logo intros on page load.
- Keep state in the URL and local storage (current page, Project, open card, filters, scroll position) so a reload or reopened tab lands in the same place.
- On iPhone, the page must work at whatever orientation and width it opens in.
