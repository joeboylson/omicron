import type { MachineSummary, UsageWindow } from "@/lib/data";
import { Group, Row } from "@/components/Grouped";
import { Progress } from "@/components/base/progress";
import { Badge } from "@/components/ui/badge";

/** Each machine's Claude account in use, and how much of each account's limits is used. */
export function Machines({ machines }: { machines: MachineSummary[] }) {
  if (machines.length === 0) return null;
  return (
    <Group title="Claude accounts">
      <ul className="divide-y" aria-label="Machines">
        {machines.map((m) => (
          <li key={m.id} className="grid gap-2 px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="tabular-nums text-sm font-medium">{m.name}</span>
              {m.accounts.in_use ? (
                <Badge variant="secondary" className="font-normal">
                  Using {m.accounts.in_use}
                </Badge>
              ) : (
                <Badge variant="outline" className="font-normal text-muted-foreground">
                  Using an account that isn't saved
                </Badge>
              )}
              {m.accounts.auto && (
                <span className="text-xs text-muted-foreground">
                  {m.accounts.auto.held
                    ? `Stays on ${m.accounts.auto.held} for now`
                    : `Moves to ${m.accounts.auto.secondary} when ${m.accounts.auto.primary} runs out`}
                </span>
              )}
            </div>
            {m.accounts.accounts.map((a) => (
              <Row key={a.name} className="grid grid-cols-[6rem_1fr] gap-x-3 gap-y-1 px-0 sm:grid-cols-[8rem_1fr_1fr]">
                <span className="text-sm">{a.name}</span>
                <Meter label="5-hour" w={a.five_hour} />
                <Meter label="Weekly" w={a.weekly} className="col-start-2 sm:col-start-auto" />
              </Row>
            ))}
          </li>
        ))}
      </ul>
    </Group>
  );
}

/** Green, then orange from 70%, red from 90%: Apple's colors for fine, look, stop. */
function Meter({ label, w, className }: { label: string; w: UsageWindow; className?: string }) {
  const percent = w?.percent ?? null;
  const color = percent === null ? "gray" : percent >= 90 ? "red" : percent >= 70 ? "orange" : "green";
  return (
    <div className={className}>
      <div className="flex items-baseline justify-between text-xs text-muted-foreground">
        <span className="tabular-nums">
          {percent === null ? `${label} limit: not known yet` : `${percent}% of the ${label.toLowerCase()} limit used`}
          {w?.resets_at && `, ${resetsIn(w.resets_at)}`}
          {/* Not by color alone (#240). */}
          {percent !== null && percent >= 90 && <span className="font-medium text-foreground"> · Almost used up</span>}
        </span>
      </div>
      <Progress
        value={percent ?? 0}
        aria-label={`${label} use`}
        className="mt-1 h-1.5"
        color={`var(--sys-${color})`}
      />
    </div>
  );
}

function resetsIn(iso: string): string {
  const mins = Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 60000));
  const days = Math.floor(mins / 1440);
  if (days >= 1) return `resets in ${days} ${days === 1 ? "day" : "days"}`;
  if (mins >= 60) return `resets in ${Math.floor(mins / 60)} hr ${mins % 60} min`;
  return `resets in ${mins} min`;
}
