import { describe, expect, it } from "vitest";
import { deviceLabelDataFile } from "./paths.js";

describe("deviceLabelDataFile", () => {
  it("uses UTC date for daily rotation", () => {
    expect(deviceLabelDataFile("/data", "room-a-sensor", "environment", new Date("2026-07-16T23:59:59.000Z")))
      .toBe("/data/devices/room-a-sensor/environment/2026-07-16.jsonl");
  });

  it("rejects unsafe path segments", () => {
    expect(() => deviceLabelDataFile("/data", "../secret", "environment")).toThrow();
  });
});
