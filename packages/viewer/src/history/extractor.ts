import jsonata from "jsonata";
import { ExtractorConfig, recordTime, StoredRecord } from "@iot-data-server/shared";

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
      points.push({ t: recordTime(record).toISOString(), v: value });
    }
  }

  return points;
}
