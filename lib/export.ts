export function toCsv(rows: Record<string, any>[], columns?: string[]): string {
  if (!rows || rows.length === 0) return '';

  const headerKeys = columns ?? Object.keys(rows[0]);
  const escape = (value: any) => {
    const str = value === null || value === undefined ? '' : String(value);
    // Escape double quotes and wrap in quotes if needed.
    const escaped = str.replace(/"/g, '""');
    return /[",\n\r]/.test(escaped) ? `"${escaped}"` : escaped;
  };

  const lines = [headerKeys.join(',')];
  for (const row of rows) {
    const cells = headerKeys.map((key) => escape(row[key]));
    lines.push(cells.join(','));
  }
  return lines.join('\n');
}

export function downloadFile(content: string, filename: string, type = 'text/csv;charset=utf-8;') {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
