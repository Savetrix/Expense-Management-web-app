import { ReactNode } from "react";

export interface DataTableColumn<T> {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  /** Right-align numeric/amount columns, matching the Stitch tables. */
  align?: "left" | "right";
  className?: string;
  /** Fixed column width (e.g. "18%", "140px"). The table uses table-fixed
   *  layout specifically so one row's unusually long content (a raw
   *  filename, a long vendor name) can never balloon a column and push
   *  every column after it off-screen — always set this for any column
   *  that renders free-form text. Columns without a width share the
   *  remaining space evenly. */
  width?: string;
}

interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  rows: T[];
  getRowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  /** Renders a leading checkbox column (dashboard's bulk-select pattern). */
  selectedKeys?: Set<string>;
  onToggleRow?: (row: T) => void;
  emptyState?: ReactNode;
  /** false when the caller already supplies the surrounding
   *  border/rounded/bg chrome (e.g. Invoices' shared filter-toolbar +
   *  table card) — renders just the scroll container + <table>, no
   *  duplicate border. Defaults to true (a fully self-contained card). */
  bordered?: boolean;
  /** Tailwind max-height class (e.g. "max-h-[560px]") that turns the table
   *  body into its own bounded, independently-scrolling region with a
   *  sticky header — required for any list that can grow past a screenful
   *  of rows, so the table gets its own scrollbar instead of pushing the
   *  page (and the rest of the screen's layout) down indefinitely.
   *  Omit for short, naturally-sized lists that don't need it. */
  maxHeightClassName?: string;
}

// Bordered header row + divided/hoverable body rows, matching the pattern
// shared by dashboard's "recent invoices" and the invoices list in the
// Stitch export. Column shape (not row shape) is generic so both screens'
// differing data can reuse the same table chrome.
export function DataTable<T>({
  columns,
  rows,
  getRowKey,
  onRowClick,
  selectedKeys,
  onToggleRow,
  emptyState,
  bordered = true,
  maxHeightClassName,
}: DataTableProps<T>) {
  const selectable = Boolean(selectedKeys && onToggleRow);
  const wrapperClassName = bordered ? "rounded-lg border border-border bg-surface" : "";

  if (rows.length === 0 && emptyState) {
    return <div className={wrapperClassName}>{emptyState}</div>;
  }

  return (
    <div
      className={`overflow-auto ${maxHeightClassName ?? ""} ${wrapperClassName}`}
    >
      <table className="w-full table-fixed border-collapse text-left">
        <colgroup>
          {selectable && <col className="w-10" />}
          {columns.map((col) => (
            <col key={col.key} style={col.width ? { width: col.width } : undefined} />
          ))}
        </colgroup>
        <thead className="border-b border-border bg-page">
          <tr>
            {selectable && <th className="sticky top-0 z-10 bg-page px-[var(--space-sm)] py-[6px]" />}
            {columns.map((col) => (
              <th
                key={col.key}
                className={`sticky top-0 z-10 overflow-hidden bg-page px-[var(--space-sm)] py-[6px] text-tiny font-bold uppercase tracking-wider text-content-muted ${
                  col.align === "right" ? "text-right" : "text-left"
                }`}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((row) => {
            const rowKey = getRowKey(row);
            const selected = selectedKeys?.has(rowKey) ?? false;
            return (
              <tr
                key={rowKey}
                onClick={() => onRowClick?.(row)}
                // Neutral hover/selected tint (bg-surface-alt), not the mint
                // accent-bg — that stays reserved for actual success/auto
                // meaning (avatar chips, badges), not generic row state.
                className={`transition-colors ${onRowClick ? "cursor-pointer" : ""} ${
                  selected ? "bg-surface-alt" : "hover:bg-surface-alt"
                }`}
              >
                {selectable && (
                  <td className="px-[var(--space-sm)] py-[6px]" onClick={(event) => event.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => onToggleRow?.(row)}
                      className="rounded border-border-strong text-accent focus:ring-accent"
                    />
                  </td>
                )}
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={`overflow-hidden px-[var(--space-sm)] py-[6px] text-caption text-content-primary ${
                      col.align === "right" ? "text-right" : "text-left"
                    } ${col.className ?? ""}`}
                  >
                    {col.render(row)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
