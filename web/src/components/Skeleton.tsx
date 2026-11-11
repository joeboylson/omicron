// Placeholders shaped like what's loading, so the page doesn't jump when it
// arrives. Read out as "Loading" once; still when Reduce Motion is on.

import { cn } from "@/lib/utils";

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("animate-pulse rounded-md bg-muted motion-reduce:animate-none", className)} />;
}

/** Wraps placeholders: one "Loading" for screen readers. */
export function Loading({ label = "Loading", className, children }: { label?: string; className?: string; children: React.ReactNode }) {
  return (
    <div role="status" aria-live="polite" className={className}>
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}

/** Rows of a grouped list. */
export function ListSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <Loading className="divide-y">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3">
          <Skeleton className="h-9 w-9 rounded-full" />
          <div className="grid flex-1 gap-2">
            <Skeleton className="h-3.5 w-1/3" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </div>
      ))}
    </Loading>
  );
}

/** A board: a few columns of cards. */
export function BoardSkeleton() {
  return (
    <Loading label="Loading the Project" className="flex flex-1 flex-col">
      <div className="px-[max(1rem,env(safe-area-inset-left))] pb-4 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <Skeleton className="mb-4 h-5 w-20" />
        <Skeleton className="h-8 w-56" />
      </div>
      <div className="flex gap-3 overflow-hidden px-[max(1rem,env(safe-area-inset-left))]">
        {[3, 2, 1].map((cards, c) => (
          <div key={c} className="flex w-[86vw] shrink-0 flex-col gap-2 rounded-xl bg-muted/60 p-2 sm:w-72">
            <Skeleton className="m-2 h-4 w-24 bg-background/60" />
            {Array.from({ length: cards }, (_, i) => (
              <Skeleton key={i} className="h-20 rounded-lg bg-background/80" />
            ))}
          </div>
        ))}
      </div>
    </Loading>
  );
}

/** The Projects list. */
export function ProjectsSkeleton() {
  return (
    <Loading label="Loading Projects" className="grid gap-3 sm:grid-cols-2">
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} className="grid gap-2 rounded-xl border p-4">
          <Skeleton className="h-5 w-2/5" />
          <Skeleton className="h-3.5 w-16" />
        </div>
      ))}
    </Loading>
  );
}
