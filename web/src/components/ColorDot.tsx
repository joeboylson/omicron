import { COLORS, colorName, sys, type Color } from "@/lib/colors";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { cn } from "@/lib/utils";

/** A small dot of a system color. Decoration: names say the same thing. */
export function ColorDot({ color, className }: { color: Color; className?: string }) {
  return <span aria-hidden className={cn("inline-block h-2.5 w-2.5 shrink-0 rounded-full", className)} style={{ background: sys(color) }} />;
}

/** Pick one of the system colors (plain shadcn Select). */
export function ColorSelect({
  value,
  onChange,
  label,
  className,
}: {
  value: Color;
  onChange: (c: Color) => void;
  label: string;
  className?: string;
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as Color)}>
      <SelectTrigger aria-label={label} className={cn("w-auto gap-2 border-0 bg-transparent px-2 shadow-none", className)}>
        <ColorDot color={value} className="h-4 w-4" />
      </SelectTrigger>
      <SelectContent align="end">
        {COLORS.map((c) => (
          <SelectItem key={c} value={c}>
            <span className="flex items-center gap-2">
              <ColorDot color={c} />
              {colorName(c)}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
