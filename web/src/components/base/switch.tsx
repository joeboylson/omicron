// Omicron's on/off switch, on shadcn's (components/ui/switch, left as
// shipped): iOS's size and green, so it's easy to tap on a phone.
import * as React from "react";
import { Switch as ShadcnSwitch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

export const Switch = React.forwardRef<React.ElementRef<typeof ShadcnSwitch>, React.ComponentPropsWithoutRef<typeof ShadcnSwitch>>(
  ({ className, ...props }, ref) => (
    <ShadcnSwitch
      ref={ref}
      className={cn(
        "h-[31px] w-[51px] data-[state=checked]:bg-[var(--sys-green)] motion-reduce:transition-none",
        "[&>span]:h-[27px] [&>span]:w-[27px] [&>span]:data-[state=checked]:translate-x-[20px] [&>span]:data-[state=unchecked]:translate-x-0",
        className,
      )}
      {...props}
    />
  ),
);
Switch.displayName = "Switch";
