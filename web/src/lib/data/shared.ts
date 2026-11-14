// Helpers the data modules share.

/** How many rows the database hands back per request at most (Supabase's
 *  PGRST_DB_MAX_ROWS, 1,000 by default). */
export const PAGE = 1000;

/** Every row of a query, page by page: a list that fills a page is read on
 *  until it's all there. `page(from, to)` is the query for those rows. */
export async function all<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string; code?: string } | null }>) {
  const rows: T[] = [];
  for (;;) {
    const r = await page(rows.length, rows.length + PAGE - 1);
    if (r.error) return { data: null as T[] | null, error: r.error };
    rows.push(...(r.data ?? []));
    if ((r.data ?? []).length < PAGE) return { data: rows, error: null };
  }
}

export const after = (xs: { position: number }[]) => xs.reduce((m, x) => Math.max(m, x.position), 0) + 1;
