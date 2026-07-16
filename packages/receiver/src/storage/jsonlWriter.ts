import { mkdir, appendFile } from "node:fs/promises";
import path from "node:path";
import { deviceLabelDataFile, StoredRecord } from "@iot-data-server/shared";

export class JsonlWriter {
  private queues = new Map<string, Promise<void>>();

  constructor(private readonly dataDir: string) {}

  async append(record: StoredRecord, date = new Date(record.receivedAt)): Promise<void> {
    const filePath = deviceLabelDataFile(this.dataDir, record.device, record.label, date);
    const previous = this.queues.get(filePath) ?? Promise.resolve();
    const next = previous.then(async () => {
      await mkdir(path.dirname(filePath), { recursive: true });
      await appendFile(filePath, `${JSON.stringify(record)}\n`, "utf8");
    });

    this.queues.set(filePath, next.catch(() => undefined));
    await next;
  }
}
