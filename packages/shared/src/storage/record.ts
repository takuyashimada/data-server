import { JsonValue } from "../config/schema.js";

export interface StoredRecord {
  receivedAt: string;
  device: string;
  label: string;
  topic: string;
  data: JsonValue;
}
