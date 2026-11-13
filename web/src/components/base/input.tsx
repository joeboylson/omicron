// Omicron's text box, on shadcn's (components/ui/input, left as shipped):
// 44pt tall on phones, so it's easy to tap.
import * as React from "react";
import { Input as ShadcnInput } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(({ className, ...props }, ref) => (
  <ShadcnInput ref={ref} className={cn("h-11 sm:h-10", className)} {...props} />
));
Input.displayName = "Input";
