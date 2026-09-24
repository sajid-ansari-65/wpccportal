/** Quote a value only when it needs it, doubling any embedded quotes (RFC 4180). */
export function toCsvValue(v: string): string {
  if (v.includes(",") || v.includes('"') || v.includes("\n")) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}

export function toCsvRow(values: readonly unknown[]): string {
  return values.map((v) => toCsvValue(v === null || v === undefined ? "" : String(v))).join(",");
}

export function toCsv(header: readonly string[], rows: readonly (readonly unknown[])[]): string {
  return [toCsvRow(header), ...rows.map(toCsvRow)].join("\n");
}
