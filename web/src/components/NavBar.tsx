import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * A navigation bar and large title, after Apple's Human Interface
 * Guidelines: back and actions in a 44pt bar at the top (clear of the
 * status bar), the page's title large below it.
 */
export function NavBar({
  left,
  right,
  title,
  titleClassName,
  inline,
}: {
  left?: ReactNode;
  right?: ReactNode;
  title: ReactNode;
  /** To line the title up with the page's content. */
  titleClassName?: string;
  /** The title in the bar itself, beside the back button (a Project, #249). */
  inline?: boolean;
}) {
  if (inline) {
    return (
      <header className="sticky top-0 z-10 bg-background/90 pt-[env(safe-area-inset-top)] backdrop-blur supports-[backdrop-filter]:bg-background/75">
        <div className="flex min-h-14 items-center gap-1 pl-[max(0.25rem,env(safe-area-inset-left))] pr-[max(0.5rem,env(safe-area-inset-right))]">
          {left}
          <h1 className={cn("min-w-0 flex-1 truncate text-xl font-bold tracking-tight sm:text-2xl", titleClassName)}>{title}</h1>
          <div className="flex shrink-0 items-center gap-1">{right}</div>
        </div>
      </header>
    );
  }
  return (
    <>
      <header className="sticky top-0 z-10 bg-background/90 pt-[env(safe-area-inset-top)] backdrop-blur supports-[backdrop-filter]:bg-background/75">
        <div className="flex h-11 items-center gap-1 pl-[max(0.5rem,env(safe-area-inset-left))] pr-[max(0.5rem,env(safe-area-inset-right))]">
          <div className="flex min-w-0 flex-1 items-center">{left}</div>
          <div className="flex shrink-0 items-center">{right}</div>
        </div>
      </header>
      <h1 className={cn("truncate px-[max(1rem,env(safe-area-inset-left))] pb-2 pt-1 text-3xl font-bold tracking-tight", titleClassName)}>
        {title}
      </h1>
    </>
  );
}
