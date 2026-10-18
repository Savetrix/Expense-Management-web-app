// Client-side CSV export for the Reports page. No BOM, CRLF line endings.
export type CsvCell = string | number | null | undefined;

export function escapeCsvCell(cell: CsvCell): string {
  if (cell === null || cell === undefined) return "";
  let text = typeof cell === "number" ? (Number.isFinite(cell) ? String(cell) : "") : cell;
  // Stop spreadsheet apps evaluating text that starts like a formula.
  if (typeof cell === "string" && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(headers: string[], rows: CsvCell[][]): string {
  return [headers, ...rows].map((row) => row.map(escapeCsvCell).join(",")).join("\r\n");
}

export function downloadCsv(filename: string, csv: string): void {
  if (typeof window === "undefined") return;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
