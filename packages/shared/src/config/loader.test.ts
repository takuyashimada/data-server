import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { findConfigDir, loadConfig, loadReceiverConfig } from "./loader.js";

describe("findConfigDir", () => {
  it("finds the project config directory from a workspace package directory", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "iot-data-server-"));
    const configDir = path.join(root, "config");
    const packageDir = path.join(root, "packages", "receiver");

    await mkdir(configDir, { recursive: true });
    await mkdir(packageDir, { recursive: true });
    await writeFile(path.join(configDir, "server.example.yaml"), "");

    expect(findConfigDir(packageDir)).toBe(configDir);
  });
});

describe("loadReceiverConfig", () => {
  it("does not validate viewer-only extractor references", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "iot-data-server-"));
    const configDir = path.join(root, "config");
    await mkdir(configDir, { recursive: true });

    await writeFile(path.join(configDir, "server.yaml"), `
server:
  logLevel: "info"
mqtt:
  host: "127.0.0.1"
  port: 1883
  maxPayloadBytes: 65536
storage:
  dataDir: "./data"
  rotation: "daily"
  dateMode: "utc"
  retentionDays: 62
viewer:
  host: "127.0.0.1"
  port: 3000
  realtime:
    mqtt:
      url: "mqtt://127.0.0.1:1883"
      username: "viewer"
      password: "viewer-token"
admin:
  passwordHash: "$argon2id$placeholder"
`);
    await writeFile(path.join(configDir, "devices.yaml"), `
devices:
  - name: "room-a-sensor"
    enabled: true
    token: "device-token"
    labels:
      - name: "environment"
        enabled: true
        readonlyView:
          enabled: true
          token: "readonly-token"
`);
    await writeFile(path.join(configDir, "extractors.yaml"), `
extractors:
  - id: "stale-extractor"
    device: "deleted-device"
    label: "environment"
    labelText: "Stale"
    expression: "temperature"
    valueType: "number"
    enabled: true
`);

    await expect(loadReceiverConfig(configDir)).resolves.toMatchObject({
      devices: [{ name: "room-a-sensor" }],
    });
    await expect(loadConfig(configDir)).rejects.toThrow(/unknown extractor target/);
  });
});
