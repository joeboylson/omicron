// Notes and comments as they're written (Markdown), shown as text people
// read: headings, lists, bold, code. Raw HTML in them is never run.
import ReactMarkdown from "react-markdown";
import { cn } from "@/lib/utils";

export function Markdown({ text, className }: { text: string; className?: string }) {
  return (
    <div
      className={cn(
        "break-words [&_a]:text-link [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground",
        "[&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:font-mono [&_code]:text-[0.9em] [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-2 [&_pre_code]:bg-transparent [&_pre_code]:p-0",
        "[&_h1]:font-semibold [&_h2]:font-semibold [&_h3]:font-semibold [&_h4]:font-semibold [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5",
        "[&>*+*]:mt-1.5",
        className,
      )}
    >
      <ReactMarkdown>{text}</ReactMarkdown>
    </div>
  );
}
