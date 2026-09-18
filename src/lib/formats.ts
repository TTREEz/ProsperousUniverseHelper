export function formatNumber(value: number | null | undefined, digits = 2) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "-";
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  }).format(value);
}

export function formatPercent(decimalValue: number | null | undefined, digits = 1) {
  if (decimalValue === null || decimalValue === undefined || !Number.isFinite(decimalValue)) return "-";
  return `${formatNumber(decimalValue * 100, digits)}%`;
}

export function normalizeTicker(value: string | null | undefined) {
  return (value ?? "").trim().toUpperCase();
}

export function titleize(value: string | null | undefined) {
  return (value ?? "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}
