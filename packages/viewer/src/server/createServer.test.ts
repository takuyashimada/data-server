import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { AppConfig } from "@iot-data-server/shared";
import { createServer } from "./createServer.js";

const config = {
  server: { logLevel: "silent" },
  mqtt: {
    host: "127.0.0.1",
    port: 1883,
    tls: { enabled: false, port: 8883, keyFile: "", certFile: "" },
    maxPayloadBytes: 65536,
    maxClientIdLength: 128,
  },
  storage: { dataDir: "./data", rotation: "daily", dateMode: "utc", retentionDays: 62 },
  viewer: {
    host: "127.0.0.1",
    port: 3000,
    realtime: { mqtt: { url: "mqtt://127.0.0.1:1883", username: "viewer", password: "viewer-token" } },
  },
  admin: { passwordHash: "placeholder" },
  devices: [
    {
      name: "room-a-sensor",
      enabled: true,
      token: "device-token",
      labels: [
        { name: "environment", enabled: true, readonlyView: { enabled: true, token: "readonly-token" } },
      ],
    },
  ],
  extractors: [
    {
      id: "room-temperature",
      device: "room-a-sensor",
      label: "environment",
      labelText: "Temperature",
      expression: "temperature",
      valueType: "number",
      unit: "degC",
      enabled: true,
    },
  ],
} as AppConfig;

describe("createServer readonly viewer", () => {
  it("serves the readonly page when the view token is valid", async () => {
    const app = createServer({
      configDir: "/tmp/config",
      get: () => config,
    }, new EventEmitter() as never);

    const response = await app.inject("/view/room-a-sensor/environment?token=readonly-token");
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.body).toContain("room-a-sensor / environment");
    expect(response.body).toContain("/assets/readonly-view.js");
  });

  it("rejects the readonly page when the view token is invalid", async () => {
    const app = createServer({
      configDir: "/tmp/config",
      get: () => config,
    }, new EventEmitter() as never);

    const response = await app.inject("/view/room-a-sensor/environment?token=wrong");
    await app.close();

    expect(response.statusCode).toBe(403);
  });

  it("serves the browser script", async () => {
    const app = createServer({
      configDir: "/tmp/config",
      get: () => config,
    }, new EventEmitter() as never);

    const response = await app.inject("/assets/readonly-view.js");
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("application/javascript");
    expect(response.body).toContain("connectRealtime");
  });
});
