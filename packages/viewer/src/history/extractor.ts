import jsonata from "jsonata";
import { ExtractorConfig, StoredRecord } from "@iot-data-server/shared";

export interface DataPoint {
  t: string;
  v: number;
}

export async function extractPoints(records: StoredRecord[], extractor: ExtractorConfig): Promise<DataPoint[]> {
  const expression = jsonata(extractor.expression);
  const points: DataPoint[] = [];

  for (const record of records) {
    const value = await expression.evaluate(record.data);
    if (typeof value === "number" && Number.isFinite(value)) {
      points.push({ t: record.receivedAt, v: value });
    }
  }

  return points;
}
