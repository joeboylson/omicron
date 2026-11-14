import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/base/popover";
import { formatDate } from "@/components/TaskCard";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/base/button";
import { Input } from "@/components/base/input";
import { bare } from "@/components/Grouped";
import { cn } from "@/lib/utils";

/** A day as YYYY-MM-DD, in local time. */
function dayISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** The task's date: shown as on its card (Nov 15), with quick picks, any
 *  day, and Clear (like Reminders and Things). */
export function DateField({
  id,
  value,
  onChange,
  none = "None",
  className,
}: {
  id?: string;
  value: string | null;
  onChange: (v: string | null) => void;
  /** Shown when there's no date. */
  none?: string;
  /** For the button that opens it, in place of a sheet row's plain style. */
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const pick = (v: string | null) => {
    onChange(v);
    setOpen(false);
  };
  const inDays = (n: number) => {
    const d = new Date();
    d.setDate(d.getDate() + n);
    return dayISO(d);
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button id={id} variant="ghost" className={className ?? cn(bare, "w-auto gap-1 pl-0 pr-3 font-normal text-muted-foreground hover:bg-transparent")}>
          {value ? formatDate(value) : none}
          <ChevronDown className="h-4 w-4 opacity-50" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent title="Date" align="end" className="grid w-60 gap-1 p-2">
        {(
          [
            ["Today", 0],
            ["Tomorrow", 1],
            ["Next week", 7],
          ] as const
        ).map(([label, n]) => (
          <Button key={label} variant="ghost" className="justify-between font-normal" onClick={() => pick(inDays(n))}>
            {label}
            <span className="text-xs text-muted-foreground">{formatDate(inDays(n))}</span>
          </Button>
        ))}
        <label className="grid gap-1 px-1 pt-1 text-xs text-muted-foreground">
          Another day
          <Input type="date" aria-label="Pick a date" value={value ?? ""} onChange={(e) => e.target.value && pick(e.target.value)} className="h-11 sm:h-9" />
        </label>
        {value && (
          <Button variant="ghost" className="justify-start font-normal text-destructive hover:text-destructive" onClick={() => pick(null)}>
            Clear the date
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}
