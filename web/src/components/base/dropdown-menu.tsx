// shadcn's dropdown menu (components/ui/dropdown-menu, left as shipped),
// with one change: a picked choice is ticked, the same mark as a ticked
// checkbox item, on the leading edge (HIG menus #7, #14). shadcn draws a dot.
import * as React from "react";
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

import { DropdownMenu as UiDropdownMenu, DropdownMenuContent as UiDropdownMenuContent } from "@/components/ui/dropdown-menu";

export {
  DropdownMenuCheckboxItem,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// Escape always closes the menu. Radix can be left thinking another layer
// is on top (one that was redrawn away as it closed), and then ignores
// Escape here; this closes it whatever Radix thinks.
const CloseMenu = React.createContext<(() => void) | null>(null);

export function DropdownMenu({ open, defaultOpen, onOpenChange, ...props }: React.ComponentProps<typeof UiDropdownMenu>) {
  const [own, setOwn] = React.useState(defaultOpen ?? false);
  const shown = open ?? own;
  const change = (o: boolean) => {
    if (open === undefined) setOwn(o);
    onOpenChange?.(o);
  };
  return (
    <CloseMenu.Provider value={() => change(false)}>
      <UiDropdownMenu open={shown} onOpenChange={change} {...props} />
    </CloseMenu.Provider>
  );
}

export const DropdownMenuContent = React.forwardRef<
  React.ElementRef<typeof UiDropdownMenuContent>,
  React.ComponentPropsWithoutRef<typeof UiDropdownMenuContent>
>(({ onKeyDown, ...props }, ref) => {
  const close = React.useContext(CloseMenu);
  return (
    <UiDropdownMenuContent
      ref={ref}
      onKeyDown={(e) => {
        onKeyDown?.(e);
        if (e.key === "Escape" && !e.defaultPrevented && close) {
          e.preventDefault();
          close();
        }
      }}
      {...props}
    />
  );
});
DropdownMenuContent.displayName = "DropdownMenuContent";

export const DropdownMenuRadioItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.RadioItem>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.RadioItem>
>(({ className, children, ...props }, ref) => (
  <DropdownMenuPrimitive.RadioItem
    ref={ref}
    className={cn(
      "relative flex cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none transition-colors focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
      className,
    )}
    {...props}
  >
    <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
      <DropdownMenuPrimitive.ItemIndicator>
        <Check className="h-4 w-4" />
      </DropdownMenuPrimitive.ItemIndicator>
    </span>
    {children}
  </DropdownMenuPrimitive.RadioItem>
));
DropdownMenuRadioItem.displayName = DropdownMenuPrimitive.RadioItem.displayName;
