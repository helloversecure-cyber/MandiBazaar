import { cn } from "@/lib/utils";

export type Column<T> = {
  /** Stable key for the column. */
  key: string;
  header: React.ReactNode;
  cell: (row: T) => React.ReactNode;
  align?: "left" | "right" | "center";
  /** Extra classes for the <td>/<th> in this column. */
  className?: string;
  /** Hide on narrow screens (keeps mobile tables readable). */
  hideOnMobile?: boolean;
};

const alignClass = { left: "text-left", right: "text-right", center: "text-center" };

/** Theme-aware table shell with a consistent header, zebra-free rows, and a
 *  built-in empty state. Horizontally scrolls on small screens. */
export function DataTable<T>({
  columns,
  rows,
  keyField,
  empty = "Nothing to show yet.",
  className,
  onRowClick,
}: {
  columns: Column<T>[];
  rows: T[];
  keyField: (row: T) => string;
  empty?: React.ReactNode;
  className?: string;
  onRowClick?: (row: T) => void;
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-line bg-card px-6 py-12 text-center text-sm text-ink-subtle">
        {empty}
      </div>
    );
  }
  return (
    <div className={cn("overflow-x-auto rounded-2xl border border-line bg-card shadow-card", className)}>
      <table className="w-full min-w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-line bg-app/60">
            {columns.map((c) => (
              <th
                key={c.key}
                className={cn(
                  "px-4 py-3 text-xs font-semibold uppercase tracking-wide text-ink-subtle",
                  alignClass[c.align ?? "left"],
                  c.hideOnMobile && "hidden sm:table-cell",
                  c.className
                )}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={keyField(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={cn(
                "border-b border-line/70 last:border-0 transition-colors",
                onRowClick && "cursor-pointer hover:bg-app/70"
              )}
            >
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={cn(
                    "px-4 py-3 text-ink",
                    alignClass[c.align ?? "left"],
                    c.hideOnMobile && "hidden sm:table-cell",
                    c.className
                  )}
                >
                  {c.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
