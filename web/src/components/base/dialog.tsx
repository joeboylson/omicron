// Omicron's dialog, built on shadcn's (components/ui/dialog, left as shadcn
// ships it): a sheet rising from the bottom on phones (Apple HIG), shadcn's
// centered dialog on larger screens, a bigger close button to tap, focus
// given back to where it was when it closes, and `focusSheet`.
import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { DialogOverlay, DialogPortal } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

/** The last control focused outside any dialog: where focus goes back to. */
let lastOutside: { el: HTMLElement; label: string | null } | null = null;
if (typeof document !== "undefined") {
  document.addEventListener("focusin", (e) => {
    const el = e.target as HTMLElement | null;
    if (el && el !== document.body && !el.closest('[role="dialog"]')) lastOutside = { el, label: el.getAttribute("aria-label") };
  });
}

/** For onOpenAutoFocus: focus the sheet itself rather than its first field
 *  (on a phone a focused field opens the keyboard), so keyboard and
 *  screen-reader users still start inside it. */
export const focusSheet = (e: Event) => {
  e.preventDefault();
  (e.currentTarget as HTMLElement | null)?.focus();
};

export const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, onCloseAutoFocus, onOpenAutoFocus, ...props }, ref) => {
  // What had focus before it opened gets focus back when it closes: the
  // last control focused outside any dialog (focus inside one doesn't count).
  // If the page redrew that control while this was open, the one with the
  // same name takes focus instead of focus being lost.
  const giveBack = (e: Event) => {
    onCloseAutoFocus?.(e);
    const before = lastOutside;
    if (e.defaultPrevented || !before) return;
    e.preventDefault();
    const target = before.el.isConnected
      ? before.el
      : before.label
        ? document.querySelector<HTMLElement>(`[aria-label="${CSS.escape(before.label)}"]`)
        : null;
    target?.focus();
  };
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          // Phones: a sheet that rises from the bottom. Larger screens:
          // shadcn's centered dialog.
          "fixed inset-x-0 bottom-0 z-50 grid w-full gap-4 rounded-t-2xl border bg-background p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] shadow-lg duration-300 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom",
          "sm:inset-x-auto sm:bottom-auto sm:left-[50%] sm:top-[50%] sm:max-w-lg sm:translate-x-[-50%] sm:translate-y-[-50%] sm:rounded-lg sm:pb-6 sm:duration-200 sm:data-[state=closed]:fade-out-0 sm:data-[state=open]:fade-in-0 sm:data-[state=closed]:zoom-out-95 sm:data-[state=open]:zoom-in-95 sm:data-[state=closed]:slide-out-to-left-1/2 sm:data-[state=closed]:slide-out-to-top-[48%] sm:data-[state=open]:slide-in-from-left-1/2 sm:data-[state=open]:slide-in-from-top-[48%]",
          className,
        )}
        onOpenAutoFocus={onOpenAutoFocus}
        onCloseAutoFocus={giveBack}
        {...props}
      >
        <div aria-hidden className="mx-auto -mt-3 h-1.5 w-10 rounded-full bg-muted-foreground/30 sm:hidden" />
        {children}
        <DialogPrimitive.Close className="absolute right-3 top-3 flex h-11 w-11 items-center justify-center rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground sm:right-2.5 sm:top-2.5 sm:h-8 sm:w-8 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11">
          <X className="h-4 w-4" />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPortal>
  );
});
DialogContent.displayName = DialogPrimitive.Content.displayName;
