// A Copy button that says what happened: "Copied" only once it worked,
// otherwise "Couldn't Copy", with the text beside it selected to copy by
// hand (#243).
import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/base/button";
import { copyText, selectText } from "@/lib/copy";
import { cn } from "@/lib/utils";

export function CopyButton({
  text,
  label = "Copy",
  className,
  icon = false,
  ...props
}: {
  text: string;
  label?: string;
  className?: string;
  icon?: boolean;
} & Omit<React.ComponentProps<typeof Button>, "onClick" | "children">) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  return (
    <Button
      variant="ghost"
      size="sm"
      className={cn(state === "failed" && "text-destructive hover:text-destructive", className)}
      onClick={async (e) => {
        const box = e.currentTarget.parentElement?.querySelector("code, [data-copy-text]");
        if (await copyText(text)) setState("copied");
        else {
          setState("failed");
          selectText(box);
        }
      }}
      {...props}
    >
      {icon && (state === "copied" ? <Check aria-hidden /> : <Copy aria-hidden />)}
      {state === "copied" ? "Copied" : state === "failed" ? "Couldn't Copy" : label}
    </Button>
  );
}
