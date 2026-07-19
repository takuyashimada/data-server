import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { AppConfig, ReceiverConfig, appConfigSchema, receiverConfigSchema } from "./schema.js";

export function findConfigDir(startDir: string): string | null {
  let current = path.resolve(startDir);

  while (true) {
    const candidate = path.join(current, "config");
    if (
      existsSync(path.join(candidate, "server.yaml")) ||
      existsSync(path.join(candidate, "server.example.yaml"))
    ) {
      return candidate;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

export function defaultConfigDir(): string {
  if (process.env.IOT_DATA_SERVER_CONFIG_DIR) {
    return process.env.IOT_DATA_SERVER_CONFIG_DIR;
  }

  const startDir = process.env.INIT_CWD ?? process.cwd();
  return findConfigDir(startDir) ?? path.resolve(startDir, "config");
}

export function resolveDataDir(configDir: string, dataDir: string): string {
  if (process.env.IOT_DATA_SERVER_DATA_DIR) {
    return process.env.IOT_DATA_SERVER_DATA_DIR;
  }

  if (path.isAbsolute(dataDir)) {
    return dataDir;
  }

  return path.resolve(configDir, "..", dataDir);
}

async function readYamlFile(filePath: string): Promise<unknown> {
  const text = await readFile(filePath, "utf8");
  return YAML.parse(text) ?? {};
}

function withEnvironmentOverrides(config: Record<string, unknown>): Record<string, unknown> {
  const realtimeMqttUrl = process.env.IOT_DATA_SERVER_VIEWER_MQTT_URL;
  if (!realtimeMqttUrl) {
    return config;
  }

  const viewer = typeof config.viewer === "object" && config.viewer !== null
    ? config.viewer as Record<string, unknown>
    : {};
  const realtime = typeof viewer.realtime === "object" && viewer.realtime !== null
    ? viewer.realtime as Record<string, unknown>
    : {};
  const mqtt = typeof realtime.mqtt === "object" && realtime.mqtt !== null
    ? realtime.mqtt as Record<string, unknown>
    : {};

  return {
    ...config,
    viewer: {
      ...viewer,
      realtime: {
        ...realtime,
        mqtt: {
          ...mqtt,
          url: realtimeMqttUrl,
        },
      },
    },
  };
}

export async function loadConfig(configDir = defaultConfigDir()): Promise<AppConfig> {
  const [server, devices, extractors] = await Promise.all([
    readYamlFile(path.join(configDir, "server.yaml")),
    readYamlFile(path.join(configDir, "devices.yaml")),
    readYamlFile(path.join(configDir, "extractors.yaml")),
  ]);

  return appConfigSchema.parse(withEnvironmentOverrides({
    ...(server as object),
    ...(devices as object),
    ...(extractors as object),
  }));
}

export async function loadReceiverConfig(configDir = defaultConfigDir()): Promise<ReceiverConfig> {
  const [server, devices] = await Promise.all([
    readYamlFile(path.join(configDir, "server.yaml")),
    readYamlFile(path.join(configDir, "devices.yaml")),
  ]);

  return receiverConfigSchema.parse(withEnvironmentOverrides({
    ...(server as object),
    ...(devices as object),
  }));
}
