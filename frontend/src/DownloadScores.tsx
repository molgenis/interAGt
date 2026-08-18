import type { ScoreRow } from '@/api'


/**
 Replace `:`, `/`, and other special chars with `_`.
 Truncate ref/alt sequences longer than 4 chars to `{length}N`.
 Example: `chr1:123456:A:AAAAAAAAAA` → `chr1_123456_A_10N` .
 */
export function sanitizeVariantForFilename(variantName: string): string {
  
  const parts = variantName.split(/[:/]/);

  if (parts.length >= 4) {
    const ref = parts[2].length > 4 ? `${parts[2].length}N` : parts[2];
    const alt = parts[3].length > 4 ? `${parts[3].length}N` : parts[3];
    parts[2] = ref;
    parts[3] = alt;
  }

  return parts.join('_').replace(/[^a-zA-Z0-9_]/g, '_');
}

export function downloadAsCSV(data: ScoreRow[], filename: string) {
  if (data.length === 0) return;

  // Extract headers (column names)
  const headers = Object.keys(data[0]);

  // Convert data to CSV rows
  const csvRows = [
    headers.join(","), // Header row
    ...data.map((row) =>
      headers.map((header) => {
        const value = row[header as keyof ScoreRow];
        // Escape commas/quotes if needed
        if (typeof value === "string" && (value.includes(",") || value.includes('"'))) {
          return `"${value.replace(/"/g, '""')}"`;
        }
        return String(value);
      }).join(",")
    ),
  ];

  // Create and download the file
  const blob = new Blob([csvRows.join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${filename}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}