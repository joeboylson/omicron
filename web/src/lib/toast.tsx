// Short messages at the bottom of the screen, with an optional action
// (like Undo). One at a time; a new one replaces the last.

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

export type Toast = { message: string; action?: { label: string; run: () => void }; seconds?: number };

const ToastContext = createContext<(t: Toast) => void>(() => {});

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<(Toast & { key: number }) | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const show = useCallback((t: Toast) => {
    clearTimeout(timer.current);
    const key = Date.now();
    setToast({ ...t, key });
    timer.current = setTimeout(() => setToast((now) => (now?.key === key ? null : now)), (t.seconds ?? 6) * 1000);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex justify-center px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        {toast && (
          <div
            role="status"
            key={toast.key}
            className="pointer-events-auto flex max-w-md items-center gap-3 rounded-xl bg-foreground px-4 py-3 text-sm text-background shadow-lg animate-in fade-in slide-in-from-bottom-2 motion-reduce:animate-none"
          >
            <span className="flex-1">{toast.message}</span>
            {toast.action && (
              <button
                type="button"
                className="-my-1 rounded-md px-2 py-1 font-semibold text-[var(--sys-blue)] hover:bg-background/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => {
                  toast.action!.run();
                  setToast(null);
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
