import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Apple's inset grouped list: rows in one rounded box, with a small heading
 * above and an optional note below.
 */
export function Group({
  title,
  note,
  label,
  id,
  children,
  className,
}: {
  /** To jump to it (like a task's checklist from the top of its sheet). */
  id?: string;
  title?: ReactNode;
  note?: ReactNode;
  /** Accessible name for the list, when the title isn't plain text. */
  label?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section id={id} aria-label={label ?? (typeof title === "string" ? title : undefined)} className={cn("grid scroll-mt-4 gap-1.5", className)}>
      {title && <h3 className="px-4 text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</h3>}
      <div className="divide-y overflow-hidden rounded-xl border bg-card">{children}</div>
      {note && <p className="px-4 text-xs text-muted-foreground">{note}</p>}
    </section>
  );
}

/** One row of a Group: at least 44pt tall. When a plain (`bare`) control
 *  in it has keyboard focus, the whole row fills and gets a ring instead. */
export function Row({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "flex min-h-11 items-center gap-3 px-4 py-1 transition-colors",
        "has-[.bare:focus-visible,input.bare:focus,input.bare:focus-within]:bg-accent has-[.bare:focus-visible,input.bare:focus,input.bare:focus-within]:ring-2 has-[.bare:focus-visible,input.bare:focus,input.bare:focus-within]:ring-inset has-[.bare:focus-visible,input.bare:focus,input.bare:focus-within]:ring-ring",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** A plain control inside a Row: no border or ring of its own (its Row shows focus). */
export const bare = "bare h-10 border-0 bg-transparent shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 focus:ring-0 focus:ring-offset-0";
