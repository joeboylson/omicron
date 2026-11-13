// Omicron's button, on shadcn's (components/ui/button, left as shipped):
// 44pt tall on phones, so it's easy to tap (Apple HIG), shadcn's sizes on
// larger screens, and links in the link color.
import * as React from "react";
import { Button as ShadcnButton, type ButtonProps } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type { ButtonProps };

const tapSizes = {
  default: "h-11 sm:h-10",
  sm: "h-11 sm:h-9",
  lg: "h-11",
  icon: "h-11 w-11 sm:h-10 sm:w-10",
} as const;

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, ...props }, ref) => (
  <ShadcnButton
    ref={ref}
    variant={variant}
    size={size}
    className={cn(tapSizes[size ?? "default"], variant === "link" && "text-link", className)}
    {...props}
  />
));
Button.displayName = "Button";
