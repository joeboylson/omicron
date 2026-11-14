// Short messages at the bottom of the screen, with an optional action
// (like Undo). One at a time; a new one replaces the last.

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

export type Toast = {
  message: string;
  action?: { label: string; run: () => void; keys?: string };
  seconds?: number;
  /** Called once it's gone without its action: timed out, replaced, or the page closed. */
  onGone?: () => void;
};

const ToastContext = createContext<(t: Toast) => void>(() => {});

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<(Toast & { key: number }) | null>(null);
  const now = useRef<(Toast & { key: number }) | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  // Gone: say so (unless its action ran), and clear it.
  const end = useCallback((ran: boolean) => {
    clearTimeout(timer.current);
    const t = now.current;
    now.current = null;
    setToast(null);
    if (t && !ran) t.onGone?.();
  }, []);
  const wait = useCallback(() => {
    clearTimeout(timer.current);
    const t = now.current;
    if (t) timer.current = setTimeout(() => now.current?.key === t.key && end(false), (t.seconds ?? 6) * 1000);
  }, [end]);
  const show = useCallback(
    (t: Toast) => {
      if (now.current) end(false);
      now.current = { ...t, key: Date.now() };
      setToast(now.current);
      wait();
    },
    [end, wait],
  );
  useEffect(() => () => end(false), [end]);
  // Kept while the pointer or focus is on it, so there's time to reach Undo.
  const hold = () => clearTimeout(timer.current);
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex justify-center px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        {toast && (
          <div
            role="status"
            key={toast.key}
            onMouseEnter={hold}
            onMouseLeave={wait}
            onFocus={hold}
            onBlur={wait}
            className="pointer-events-auto flex max-w-md items-center gap-3 rounded-xl bg-foreground px-4 py-3 text-sm text-background shadow-lg animate-in fade-in slide-in-from-bottom-2 motion-reduce:animate-none"
          >
            <span className="flex-1">{toast.message}</span>
            {toast.action && (
              <button
                type="button"
                aria-keyshortcuts={toast.action.keys}
                className="-my-1 rounded-md px-2 py-1 font-semibold text-link-inverse hover:bg-background/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => {
                  toast.action!.run();
                  end(true);
                }}
              >
                {toast.action.label}
              </button>
            )}
          </div>
        )}
      </div>
    </ToastContext.Provider>
  );
}
