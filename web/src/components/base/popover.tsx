// shadcn's popover, as a titled sheet from the bottom on a phone (Apple
// HIG popovers #3: no floating boxes on iPhone). On larger screens it's the
// popover as shipped. The sheet look is CSS: index.css moves the popover
// to the bottom of the screen when it carries `sheet-on-phone`.
import * as React from "react";
import { Popover, PopoverContent as UiPopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export { Popover, PopoverTrigger };

export const PopoverContent = React.forwardRef<
  React.ElementRef<typeof UiPopoverContent>,
  React.ComponentPropsWithoutRef<typeof UiPopoverContent> & {
    /** Shown at the top of the sheet on a phone. */
    title?: string;
  }
>(({ className, title, children, ...props }, ref) => (
  <UiPopoverContent
    ref={ref}
    className={cn(
      className,
      "sheet-on-phone max-sm:w-full max-sm:max-w-none max-sm:max-h-[75dvh] max-sm:overflow-y-auto max-sm:rounded-b-none max-sm:rounded-t-2xl max-sm:pb-[max(1rem,env(safe-area-inset-bottom))] max-sm:shadow-[0_0_0_100vmax_rgba(0,0,0,0.4)]",
    )}
    {...props}
  >
    {title && <p className="px-3 pb-2 pt-1 text-base font-semibold sm:hidden">{title}</p>}
    {children}
  </UiPopoverContent>
));
PopoverContent.displayName = "PopoverContent";
