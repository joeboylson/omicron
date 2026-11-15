import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** "smooth" unless Reduce Motion is on (HIG accessibility: scripted motion follows it). */
export function scrollMotion(): ScrollBehavior {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
}

/** Left/right (and up/down) arrows move between the choices of a
 *  role="radiogroup", choosing as they go, like a native radio group (HIG
 *  keyboards #1). Put on each choice's onKeyDown. */
export function radioArrows(e: React.KeyboardEvent<HTMLElement>) {
  const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
  if (!step) return;
  const group = e.currentTarget.closest('[role="radiogroup"]');
  const radios = group ? [...group.querySelectorAll<HTMLElement>('[role="radio"]')] : [];
  const next = radios[(radios.indexOf(e.currentTarget) + step + radios.length) % radios.length];
  if (!next) return;
  e.preventDefault();
  next.focus();
  next.click();
}
