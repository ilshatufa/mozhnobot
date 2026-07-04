const UNITS = ["B", "KB", "MB", "GB", "TB", "PB"] as const;

export function formatBytesDecimal(value: number | null): string | null {
  if (value === null || !Number.isFinite(value)) return null;
  if (value === 0) return "0 B";

  const sign = value < 0 ? "-" : "";
  let size = Math.abs(value);
  let unitIndex = 0;

  while (size >= 1000 && unitIndex < UNITS.length - 1) {
    size /= 1000;
    unitIndex += 1;
  }

  const precision = size >= 100 || unitIndex === 0 ? 0 : size >= 10 ? 1 : 2;
  return `${sign}${size.toFixed(precision)} ${UNITS[unitIndex]}`;
}
