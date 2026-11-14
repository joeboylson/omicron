// A comment's images, full screen (like Photos): as big as fits, tap to
// see it at full size and drag around, swipe or arrow keys for the next.
import { useEffect, useRef, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { ChevronLeft, ChevronRight, ExternalLink, X } from "lucide-react";
import { cn } from "@/lib/utils";

export function ImageViewer({
  images,
  at,
  link,
  name,
  onAt,
  onClose,
}: {
  /** The comment's images (paths), and which one is showing (null: closed). */
  images: string[];
  at: number | null;
  link: (path: string) => string | undefined;
  name: (path: string) => string;
  onAt: (i: number) => void;
  onClose: () => void;
}) {
  const [zoomed, setZoomed] = useState(false);
  const start = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => setZoomed(false), [at]);
  const path = at === null ? null : images[at];
  const go = (d: number) => at !== null && images.length > 1 && onAt((at + d + images.length) % images.length);
  const src = path ? link(path) : undefined;

  return (
    <DialogPrimitive.Root open={at !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Content
          className="fixed inset-0 z-50 flex flex-col bg-black text-white outline-none"
          onKeyDown={(e) => {
            if (e.key === "ArrowRight") go(1);
            else if (e.key === "ArrowLeft") go(-1);
            else if (e.key === "z" || e.key === "Z") setZoomed((z) => !z);
            else return;
            e.preventDefault();
          }}
        >
          <div className="flex shrink-0 items-center gap-2 px-[max(0.5rem,env(safe-area-inset-left))] pt-[max(0.5rem,env(safe-area-inset-top))]">
            <DialogPrimitive.Title className="min-w-0 flex-1 truncate px-2 text-sm">{path && name(path)}</DialogPrimitive.Title>
            <DialogPrimitive.Description className="sr-only">
              The image at full size. Tap it or press Z to zoom; arrow keys or swipe for the others.
            </DialogPrimitive.Description>
            {images.length > 1 && at !== null && (
              <span className="shrink-0 font-mono text-xs text-white/70">
                {at + 1} of {images.length}
              </span>
            )}
            {src && (
              <a
                href={src}
                target="_blank"
                rel="noreferrer"
                className="flex min-h-11 shrink-0 items-center gap-1.5 rounded-md px-3 text-sm hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
              >
                <ExternalLink className="h-4 w-4" aria-hidden /> Open original
              </a>
            )}
            <DialogPrimitive.Close
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </DialogPrimitive.Close>
          </div>
          <div
            className={cn("relative min-h-0 flex-1", zoomed ? "overflow-auto" : "flex items-center justify-center overflow-hidden p-2")}
            style={{ touchAction: zoomed ? "pan-x pan-y pinch-zoom" : "pinch-zoom" }}
            onPointerDown={(e) => (start.current = { x: e.clientX, y: e.clientY })}
            onPointerUp={(e) => {
              const s = start.current;
              start.current = null;
              if (!s || zoomed) return;
              const dx = e.clientX - s.x;
              // A sideways swipe: the next or previous one.
              if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(e.clientY - s.y)) go(dx < 0 ? 1 : -1);
            }}
          >
            {src && (
              <img
                src={src}
                alt={path ? name(path) : ""}
                draggable={false}
                onClick={() => setZoomed((z) => !z)}
                className={cn("select-none", zoomed ? "max-w-none cursor-zoom-out" : "max-h-full max-w-full cursor-zoom-in object-contain")}
              />
            )}
            {images.length > 1 && !zoomed && (
              <>
                <button
                  type="button"
                  aria-label="Previous image"
                  onClick={() => go(-1)}
                  className="absolute left-2 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 hover:bg-black/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                >
                  <ChevronLeft className="h-6 w-6" />
                </button>
                <button
                  type="button"
                  aria-label="Next image"
                  onClick={() => go(1)}
                  className="absolute right-2 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 hover:bg-black/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                >
                  <ChevronRight className="h-6 w-6" />
                </button>
              </>
            )}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
