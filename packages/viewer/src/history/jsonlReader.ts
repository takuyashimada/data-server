import { createReadStream } from "node:fs";
import { access } from "node:fs/promises";
import { createInterface } from "node:readline";
import { deviceLabelDataFile, StoredRecord } from "@iot-data-server/shared";

function datesBetween(from: Date, to: Date): Date[] {
  const dates: Date[] = [];
  const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  const end = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()));

  while (cursor <= end) {
    dates.push(new Date(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return dates;
}

export async function readRecords(
  dataDir: string,
  device: string,
  label: string,
  from: Date,
  to: Date,
): Promise<StoredRecord[]> {
  const records: StoredRecord[] = [];

  for (const date of datesBetween(from, to)) {
    const filePath = deviceLabelDataFile(dataDir, device, label, date);
    try {
      await access(filePath);
    } catch {
      continue;
    }

    const lines = createInterface({
      input: createReadStream(filePath, { encoding: "utf8" }),
      crlfDelay: Infinity,
    });

    for await (const line of lines) {
      if (!line.trim()) {
        continue;
      }

      const record = JSON.parse(line) as StoredRecord;
      const receivedAt = new Date(record.receivedAt);
      if (receivedAt >= from && receivedAt <= to) {
        records.push(record);
      }
    }
  }

  return records;
}
