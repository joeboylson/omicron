// Omicron's select, on shadcn's (components/ui/select, left as shipped):
// its trigger is 44pt tall on phones, so it's easy to tap.
import * as React from "react";
import { SelectTrigger as ShadcnSelectTrigger } from "@/components/ui/select";
import { cn } from "@/lib/utils";

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectValue,
} from "@/components/ui/select";

export const SelectTrigger = React.forwardRef<
  React.ElementRef<typeof ShadcnSelectTrigger>,
  React.ComponentPropsWithoutRef<typeof ShadcnSelectTrigger>
>(({ className, ...props }, ref) => <ShadcnSelectTrigger ref={ref} className={cn("h-11 sm:h-10", className)} {...props} />);
SelectTrigger.displayName = "SelectTrigger";
