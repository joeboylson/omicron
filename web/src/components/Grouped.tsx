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
  children,
  className,
}: {
  title?: ReactNode;
  note?: ReactNode;
  /** Accessible name for the list, when the title isn't plain text. */
  label?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section aria-label={label ?? (typeof title === "string" ? title : undefined)} className={cn("grid gap-1.5", className)}>
      {title && <h3 className="px-4 text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</h3>}
      <div className="divide-y overflow-hidden rounded-xl border bg-card">{children}</div>
      {note && <p className="px-4 text-xs text-muted-foreground">{note}</p>}
    </section>
  );
}

/** One row of a Group: at least 44pt tall. */
export function Row({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex min-h-11 items-center gap-3 px-4 py-1", className)}>{children}</div>;
}

/** A plain control inside a Row: no border of its own. */
export const bare = "h-10 border-0 bg-transparent shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 focus:ring-0 focus:ring-offset-0";
