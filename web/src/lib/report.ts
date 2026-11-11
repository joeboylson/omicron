// Tell the Web Machine about an error the page caught, so it lands in its
// log (and can be fixed without anyone copying it from the screen).

const recent = new Map<string, number>();

export type ErrorKind = "crash" | "uncaught" | "action" | "sign-in";

export function reportError(kind: ErrorKind, error: unknown) {
  const e = error instanceof Error ? error : new Error(typeof error === "string" ? error : JSON.stringify(error));
  // The same error again within 10 seconds isn't sent again.
  const key = `${kind}:${e.message}`;
  const now = Date.now();
  if ((recent.get(key) ?? 0) > now - 10_000) return;
  recent.set(key, now);
  try {
    void fetch("/api/page-error", {
      method: "POST",
      keepalive: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind,
        message: e.message,
        stack: e.stack ?? "",
        url: window.location.pathname,
        agent: navigator.userAgent,
      }),
    }).catch(() => {});
  } catch {
    // Reporting must never cause an error of its own.
  }
}
