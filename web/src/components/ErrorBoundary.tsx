import { Component, type ReactNode } from "react";
import { Button } from "@/components/base/button";
import { reportError } from "@/lib/report";

/**
 * Catches an error that would otherwise leave a blank page, and says what
 * went wrong instead.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error("Omicron page error:", error);
    reportError("crash", error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main role="alert" className="mx-auto grid max-w-md gap-4 p-6 pt-[max(1.5rem,env(safe-area-inset-top))]">
        <h1 className="text-2xl font-bold tracking-tight">Something went wrong</h1>
        <p className="text-sm text-muted-foreground">The page hit an error and stopped. Reloading usually fixes it.</p>
        <pre className="overflow-x-auto whitespace-pre-wrap rounded-xl border bg-card p-3 font-mono text-xs" data-testid="page-error">
          {this.state.error.message || String(this.state.error)}
        </pre>
        <Button onClick={() => window.location.reload()}>Reload</Button>
      </main>
    );
  }
}
