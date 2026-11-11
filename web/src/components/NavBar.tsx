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
}: {
  left?: ReactNode;
  right?: ReactNode;
  title: ReactNode;
  /** To line the title up with the page's content. */
  titleClassName?: string;
}) {
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
