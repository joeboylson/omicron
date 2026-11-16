/**
 * The on-screen keyboard's height (#264), as `--keyboard` on the page, with
 * `data-keyboard` set while it's up, so sheets at the bottom of a phone's
 * screen sit above it instead of behind it.
 *
 * Android's Chrome shrinks the page itself (the viewport tag asks it to,
 * with interactive-widget=resizes-content), so there this stays 0. Safari
 * on iOS doesn't: the page stays full height and the keyboard covers its
 * bottom, which the visible part of the page (visualViewport) shows.
 */
export function keyboardHeight(innerHeight: number, visibleHeight: number, visibleTop: number): number {
  const covered = Math.round(innerHeight - visibleHeight - visibleTop);
  // Small differences are toolbars coming and going, not a keyboard.
  return covered > 80 ? covered : 0;
}

export function followKeyboard(): void {
  const vv = window.visualViewport;
  if (!vv) return;
  const root = document.documentElement;
  const update = () => {
    const h = keyboardHeight(window.innerHeight, vv.height, vv.offsetTop);
    root.style.setProperty("--keyboard", `${h}px`);
    root.toggleAttribute("data-keyboard", h > 0);
  };
  vv.addEventListener("resize", update);
  vv.addEventListener("scroll", update);
  update();
}
