import { normalizeTicker } from "@/lib/formats";

export type AnyRecord = Record<string, unknown>;

export function asRecord(value: unknown): AnyRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as AnyRecord) : null;
}

export function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  const record = asRecord(value);
  if (!record) return [];
  for (const key of ["data", "Data", "rows", "Rows", "result", "Result", "items", "Items"]) {
    if (Array.isArray(record[key])) return record[key] as unknown[];
  }
  return [];
}

export function pickField(record: AnyRecord, candidates: string[]) {
  for (const key of candidates) {
    if (key in record) return record[key];
  }
  return undefined;
}

export function asString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export function asBoolean(value: unknown) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value.toLowerCase() === "true") return true;
    if (value.toLowerCase() === "false") return false;
  }
  return null;
}

export function asNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function parseCsvLine(line: string) {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === "\"") {
      if (inQuotes && line[index + 1] === "\"") {
        current += "\"";
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (character === "," && !inQuotes) {
      values.push(current);
      current = "";
      continue;
    }
    current += character;
  }

  values.push(current);
  return values;
}

export function parseCsvRecords(csvText: string): AnyRecord[] {
  const lines = csvText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const cells = parseCsvLine(line);
    const record: AnyRecord = {};
    headers.forEach((header, index) => {
      record[header] = cells[index] ?? "";
    });
    return record;
  });
}

export function normalizeCommodity(value: unknown) {
  const record = asRecord(value);
  if (!record) return null;
  const ticker = asString(pickField(record, ["CommodityTicker", "MaterialTicker", "Ticker", "ticker"]));
  const amount = asNumber(pickField(record, ["Amount", "amount", "Quantity", "quantity"]));
  if (!ticker || amount === null) return null;
  return {
    ticker: normalizeTicker(ticker),
    name: asString(pickField(record, ["CommodityName", "MaterialName", "Name", "name"])),
    amount,
    weight: asNumber(pickField(record, ["Weight", "weight"])),
    volume: asNumber(pickField(record, ["Volume", "volume"])),
  };
}
