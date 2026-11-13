// Omicron's progress bar, on shadcn's (components/ui/progress, left as
// shipped): its bar can take a color.
import * as React from "react";
import { Progress as ShadcnProgress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

export const Progress = React.forwardRef<
  React.ElementRef<typeof ShadcnProgress>,
  React.ComponentPropsWithoutRef<typeof ShadcnProgress> & { color?: string }
>(({ className, color, style, ...props }, ref) => (
  <ShadcnProgress
    ref={ref}
    className={cn(color && "[&>div]:bg-[var(--bar-color)]", className)}
    style={color ? ({ ...style, "--bar-color": color } as React.CSSProperties) : style}
    {...props}
  />
));
Progress.displayName = "Progress";
