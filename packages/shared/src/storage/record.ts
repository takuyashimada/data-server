import { JsonValue, LabelConfig } from "../config/schema.js";

export interface StoredRecord {
  receivedAt: string;
  measuredAt?: string;
  device: string;
  label: string;
  topic: string;
  data: JsonValue;
}

export function recordTime(record: Pick<StoredRecord, "receivedAt" | "measuredAt">): Date {
  return new Date(record.measuredAt ?? record.receivedAt);
}

export function extractMeasuredAt(data: JsonValue, label: LabelConfig): string | undefined {
  if (!label.timestamp || data === null || typeof data !== "object" || Array.isArray(data)) {
    return undefined;
  }

  const value = data[label.timestamp];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }

  return date.toISOString();
}
