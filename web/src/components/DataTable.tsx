// Every table in Omicron: shadcn's Data Table (TanStack Table on shadcn's
// Table). A page hands it its rows and its columns; it searches, sorts and
// says when nothing matches.
import { Fragment, useState, type ReactNode } from "react";
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
  type Cell,
  type Column,
  type ColumnDef,
  type RowData,
  type SortingState,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ArrowUpDown, Search } from "lucide-react";
import { Input } from "@/components/base/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

export type { ColumnDef };

declare module "@tanstack/react-table" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> {
    /** Classes for the column's heading and cells (like hiding it on phones). */
    className?: string;
    /** On a phone the table is a list, one block per row: this cell is its
     *  first line ("main"), at that line's end ("end"), on a line below
     *  ("below", the default), or not shown ("hide"). */
    phone?: "main" | "end" | "below" | "hide";
  }
}

/** Does this text have every typed word, ignoring case? */
export function hasWords(text: string, query: string): boolean {
  const t = text.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => t.includes(w));
}

/** A column heading that sorts by it when clicked (A to Z, then back). */
export function SortHeader<T>({ column, label }: { column: Column<T, unknown>; label: string }) {
  const dir = column.getIsSorted();
  const Icon = dir === "asc" ? ArrowUp : dir === "desc" ? ArrowDown : ArrowUpDown;
  return (
    <button
      type="button"
      onClick={() => column.toggleSorting(dir === "asc")}
      className={cn("-ml-2 inline-flex h-8 items-center gap-1 whitespace-nowrap rounded-md px-2 hover:bg-accent", dir && "text-foreground")}
    >
      {label}
      <Icon className={cn("h-3.5 w-3.5", !dir && "opacity-40")} aria-hidden />
    </button>
  );
}

export function DataTable<T>({
  label,
  columns,
  data,
  search,
  rowLabel,
  initialSort,
  empty,
  toolbar,
  onRowTap,
}: {
  /** On a phone, a tap anywhere on a row (besides its controls) does this. */
  onRowTap?: (row: T) => void;
  /** More filters, beside the search box. */
  toolbar?: ReactNode;
  /** What the table is called to screen readers (and tests). */
  label: string;
  columns: ColumnDef<T, any>[];
  data: T[];
  /** A search box over the rows: its label, and each row's searchable text. */
  search?: { label: string; placeholder: string; text: (row: T) => string };
  /** Each row's name, to screen readers. */
  rowLabel?: (row: T) => string;
  initialSort?: SortingState;
  /** Shown when there are no rows at all. */
  empty?: ReactNode;
}) {
  const [sorting, setSorting] = useState<SortingState>(initialSort ?? []);
  const [query, setQuery] = useState("");
  const table = useReactTable({
    data,
    columns,
    state: { sorting, globalFilter: query },
    onSortingChange: setSorting,
    onGlobalFilterChange: setQuery,
    globalFilterFn: (row, _id, q: string) => !search || hasWords(search.text(row.original), q),
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });
  const rows = table.getRowModel().rows;
  const nothing = data.length === 0 ? (empty ?? "Nothing here yet.") : `Nothing matches “${query}”.`;
  // Called, not mounted: a page's cells are new functions each render, and
  // mounting them would remount (and close) what's open in them.
  const show = (c: Cell<T, unknown>) => (
    <Fragment key={c.id}>
      {typeof c.column.columnDef.cell === "function" ? c.column.columnDef.cell(c.getContext()) : flexRender(c.column.columnDef.cell, c.getContext())}
    </Fragment>
  );
  return (
    <div className="grid min-w-0 gap-3">
      {(search || toolbar) && (
        <div className="flex flex-wrap items-center gap-2">
          {search && (
            <div className="relative w-full max-w-sm">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={search.placeholder} aria-label={search.label} className="pl-9" />
            </div>
          )}
          {toolbar}
        </div>
      )}
      {/* On a phone: a list, one block per row (a table doesn't fit). */}
      <ul aria-label={label} className={cn("min-w-0 divide-y rounded-lg border sm:hidden", rows.length === 0 && "hidden")}>
        {rows.map((r) => {
          const cells = r.getVisibleCells();
          const at = (where: string) => cells.filter((c) => (c.column.columnDef.meta?.phone ?? "below") === where);
          return (
            <li
              key={r.id}
              aria-label={rowLabel?.(r.original)}
              className={cn("grid gap-2 p-3", onRowTap && "cursor-pointer active:bg-accent")}
              onClick={(e) => {
                // Not when a link or control inside it was tapped.
                if (onRowTap && !(e.target as HTMLElement).closest("a, button, input, select, [role=combobox]")) onRowTap(r.original);
              }}
            >
              <div className="flex min-h-9 items-center gap-2">
                <div className="min-w-0 flex-1 break-words">{at("main").map(show)}</div>
                {at("end").map(show)}
              </div>
              {at("below").map(show)}
            </li>
          );
        })}
      </ul>
      <div className="hidden min-w-0 rounded-lg border sm:block">
        <Table aria-label={label}>
          <TableHeader>
            {table.getHeaderGroups().map((g) => (
              <TableRow key={g.id}>
                {g.headers.map((h) => {
                  const dir = h.column.getIsSorted();
                  return (
                    <TableHead
                      key={h.id}
                      className={h.column.columnDef.meta?.className}
                      aria-sort={h.column.getCanSort() ? (dir === "asc" ? "ascending" : dir === "desc" ? "descending" : "none") : undefined}
                    >
                      {h.isPlaceholder ? null : flexRender(h.column.columnDef.header, h.getContext())}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id} aria-label={rowLabel?.(r.original)}>
                {r.getVisibleCells().map((c) => (
                  <TableCell key={c.id} className={c.column.columnDef.meta?.className}>
                    {show(c)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {/* Once, for the list and the table alike. */}
      {rows.length === 0 && <p className="px-1 text-sm text-muted-foreground">{nothing}</p>}
    </div>
  );
}
