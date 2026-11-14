

/** "now", "5m", "3h", "2d", then the date. */
export function when(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)}h`;
  if (minutes < 60 * 24 * 7) return `${Math.round(minutes / 1440)}d`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** How long ago, in words: "just now", "1 min ago", "3 hr ago", "2 days ago". */
export function ago(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)} hr ago`;
  const days = Math.round(minutes / 1440);
  if (days < 7) return `${days} ${days === 1 ? "day" : "days"} ago`;
  return `on ${new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
}
