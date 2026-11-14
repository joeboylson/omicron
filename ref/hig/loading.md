# Loading
Source: https://developer.apple.com/design/human-interface-guidelines/loading

## In one line
The best loading finishes before people notice it; when it can't, show something right away and say how long it will take.

## Rules
1. Show something as soon as you can. A blank screen while loading reads as a broken app; show placeholder text, graphics or animation and replace it as the content arrives. [Best practices]
2. Let people do other things while content loads in the background. [Best practices]
3. If loading must take a long time, give people something worth looking at meanwhile (tips, new features), and estimate the time well enough that it neither runs out nor repeats. [Best practices]
4. Download large assets in the background, at times that don't get in the way, to keep install and launch fast. [Best practices]
5. Make it clear that content is loading and how long it might take. Ideally it shows instantly; past a moment or two, show a progress indicator. [Showing progress]
6. Use a determinate progress indicator when you know how long it will take, and an indeterminate one when you don't. [Showing progress]
7. Showing a loading indicator for a second or two is better than showing a blank screen. [Platform considerations, watchOS]

## How it applies to a web app on iPhone and Mac
- Render the page frame (header, columns, table shell) at once and use skeleton placeholders for rows and cards, not a full-page spinner.
- Load each part separately so the rest of the page stays usable while one panel waits.
- For long jobs with known size (an upload, a batch), show a progress bar with a percent; for unknown waits, a spinner placed where the result will appear.
- Keep big bundles and data out of the first load: lazy-load pages and fetch extras after the first screen is up.
