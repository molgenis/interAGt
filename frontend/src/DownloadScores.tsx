import type { ScoreRow } from '@/api'

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