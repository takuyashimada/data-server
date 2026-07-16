import { describe, expect, it } from "vitest";
import { parseDataTopic } from "./topics.js";

describe("parseDataTopic", () => {
  it("parses the accepted device data topic shape", () => {
    expect(parseDataTopic("devices/room-a-sensor/data/environment")).toEqual({
      device: "room-a-sensor",
      label: "environment",
    });
  });

  it("rejects topics with extra segments", () => {
    expect(parseDataTopic("devices/room-a-sensor/data/environment/raw")).toBeNull();
  });

  it("rejects unsafe topic segments", () => {
    expect(parseDataTopic("devices/../secret/data/environment")).toBeNull();
  });
});
