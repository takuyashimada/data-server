import { AppConfig, LabelConfig, canDevicePublish, loadConfig } from "@iot-data-server/shared";

export class ConfigRef {
  constructor(private value: AppConfig) {}

  get(): AppConfig {
    return this.value;
  }

  set(value: AppConfig): void {
    this.value = value;
  }
}

export async function reloadConfig(configRef: ConfigRef, configDir: string): Promise<AppConfig> {
  const next = await loadConfig(configDir);
  configRef.set(next);
  return next;
}

export function disconnectUnauthorizedClients(broker: any, config: AppConfig): number {
  let disconnected = 0;
  for (const client of Object.values(broker.clients ?? {}) as any[]) {
    if (client.role !== "device" || !client.deviceName) {
      continue;
    }

    const labels = config.devices.find((device) => device.name === client.deviceName && device.enabled)?.labels ?? [];
    const canPublishAny = labels.some((label: LabelConfig) =>
      canDevicePublish(config, client.deviceName, `devices/${client.deviceName}/data/${label.name}`));
    if (!canPublishAny) {
      client.close?.();
      disconnected += 1;
    }
  }
  return disconnected;
}
