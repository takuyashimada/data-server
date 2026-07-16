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

async function readYamlFile(filePath: string): Promise<unknown> {
  const text = await readFile(filePath, "utf8");
  return YAML.parse(text) ?? {};
}

export async function loadConfig(configDir = defaultConfigDir()): Promise<AppConfig> {
  const [server, devices, extractors] = await Promise.all([
    readYamlFile(path.join(configDir, "server.yaml")),
    readYamlFile(path.join(configDir, "devices.yaml")),
    readYamlFile(path.join(configDir, "extractors.yaml")),
  ]);

  return appConfigSchema.parse({
    ...(server as object),
    ...(devices as object),
    ...(extractors as object),
  });
}

export async function loadReceiverConfig(configDir = defaultConfigDir()): Promise<ReceiverConfig> {
  const [server, devices] = await Promise.all([
    readYamlFile(path.join(configDir, "server.yaml")),
    readYamlFile(path.join(configDir, "devices.yaml")),
  ]);

  return receiverConfigSchema.parse({
    ...(server as object),
    ...(devices as object),
  });
}
