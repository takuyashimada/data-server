import { readFile } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { AppConfig, appConfigSchema } from "./schema.js";

export function defaultConfigDir(): string {
  return process.env.IOT_DATA_SERVER_CONFIG_DIR ?? path.resolve(process.cwd(), "config");
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
