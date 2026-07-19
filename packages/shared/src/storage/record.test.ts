import { describe, expect, it } from "vitest";
import { extractMeasuredAt, recordTime, StoredRecord } from "./record.js";
import { LabelConfig } from "../config/schema.js";

const label = {
  name: "environment",
  enabled: true,
  timestamp: "measuredAt",
  readonlyView: { enabled: true, token: "readonly-token" },
} satisfies LabelConfig;

describe("record time helpers", () => {
  it("extracts measuredAt from a configured numeric JSON object field", () => {
    expect(extractMeasuredAt({ measuredAt: 1784212800123, value: 10 }, label))
      .toBe("2026-07-16T14:40:00.123Z");
  });

  it("ignores missing or non-numeric timestamp fields", () => {
    expect(extractMeasuredAt({ measuredAt: "1784212800123" }, label)).toBeUndefined();
    expect(extractMeasuredAt([1784212800123], label)).toBeUndefined();
  });

  it("prefers measuredAt over receivedAt for display and filtering time", () => {
    const record: StoredRecord = {
      receivedAt: "2026-07-16T10:00:00.000Z",
      measuredAt: "2026-07-16T09:59:58.000Z",
      device: "room-a-sensor",
      label: "environment",
      topic: "devices/room-a-sensor/data/environment",
      data: { value: 10 },
    };

    expect(recordTime(record).toISOString()).toBe("2026-07-16T09:59:58.000Z");
  });
});
