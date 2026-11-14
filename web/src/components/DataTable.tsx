// Every table in Omicron: shadcn's Data Table (TanStack Table on shadcn's
// Table). A page hands it its rows and its columns; it searches, sorts and
// says when nothing matches.
import { useState, type ReactNode } from "react";
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
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
      className={cn("-ml-2 inline-flex h-8 items-center gap-1 rounded-md px-2 hover:bg-accent", dir && "text-foreground")}
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
}: {
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
      <div className="min-w-0 rounded-lg border">
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
                    {/* Called, not mounted: a page's cells are new functions each render, and mounting them would remount (and close) what's open in them. */}
                    {typeof c.column.columnDef.cell === "function" ? c.column.columnDef.cell(c.getContext()) : flexRender(c.column.columnDef.cell, c.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))}
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={columns.length} className="text-muted-foreground">
                  {data.length === 0 ? (empty ?? "Nothing here yet.") : `Nothing matches “${query}”.`}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
