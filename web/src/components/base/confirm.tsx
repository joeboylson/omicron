// Asking before something that can't be undone: shadcn's alert dialog
// (components/ui/alert-dialog, left as shipped) as Apple's alerts are. A
// title, at most one sentence, Cancel and the action. No close button and
// no closing by tapping outside; Escape or Cancel backs out. No button is
// focused at first, so Return doesn't do the action without reading.
import * as React from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function Confirm({
  open,
  onOpenChange,
  title,
  sentence,
  action,
  onConfirm,
  destructive = true,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** A question, like "Delete 'bills'?" */
  title: string;
  /** At most one sentence: what happens, like "It comes off 4 tasks." */
  sentence?: string;
  /** The action's name, like "Delete Label". */
  action: string;
  onConfirm: () => void;
  destructive?: boolean;
}) {
  const content = React.useRef<HTMLDivElement>(null);
  // Opened from a menu item: Radix's menu and alert can each leave the page
  // unclickable (pointer-events: none on the body) once both have closed.
  React.useEffect(() => {
    if (open) return;
    const t = setTimeout(() => {
      if (!document.querySelector('[role="dialog"],[role="alertdialog"],[role="menu"]')) document.body.style.pointerEvents = "";
    }, 300);
    return () => clearTimeout(t);
  }, [open]);
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent
        ref={content}
        tabIndex={-1}
        className="max-w-sm focus:outline-none"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          content.current?.focus();
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {sentence ? <AlertDialogDescription>{sentence}</AlertDialogDescription> : <AlertDialogDescription className="sr-only">{title}</AlertDialogDescription>}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="h-11 sm:h-10">Cancel</AlertDialogCancel>
          <AlertDialogAction
            className={cn(destructive && buttonVariants({ variant: "destructive" }), "h-11 sm:h-10")}
            onClick={() => onConfirm()}
          >
            {action}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
