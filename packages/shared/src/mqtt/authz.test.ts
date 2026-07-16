import { describe, expect, it } from "vitest";
import { AppConfig } from "../config/schema.js";
import { canDevicePublish } from "./authz.js";

const config = {
  devices: [
    {
      name: "room-a-sensor",
      enabled: true,
      token: "device-token",
      labels: [
        { name: "environment", enabled: true, readonlyView: { enabled: true, token: "view-token" } },
        { name: "power", enabled: false, readonlyView: { enabled: false } },
      ],
    },
  ],
} as AppConfig;

describe("canDevicePublish", () => {
  it("allows an enabled label for the authenticated device", () => {
    expect(canDevicePublish(config, "room-a-sensor", "devices/room-a-sensor/data/environment")).toBe(true);
  });

  it("rejects disabled labels", () => {
    expect(canDevicePublish(config, "room-a-sensor", "devices/room-a-sensor/data/power")).toBe(false);
  });

  it("rejects other devices", () => {
    expect(canDevicePublish(config, "room-a-sensor", "devices/other-device/data/environment")).toBe(false);
  });
});
