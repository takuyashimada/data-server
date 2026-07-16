import path from "node:path";
import { isSafeName } from "../mqtt/topics.js";

export function utcDatePathPart(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function deviceLabelDataFile(dataDir: string, device: string, label: string, date = new Date()): string {
  if (!isSafeName(device) || !isSafeName(label)) {
    throw new Error(`invalid device or label: ${device}/${label}`);
  }

  return path.join(dataDir, "devices", device, label, `${utcDatePathPart(date)}.jsonl`);
}
