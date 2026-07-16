import { LabelConfig, ReceiverConfig, canDevicePublish, loadReceiverConfig } from "@iot-data-server/shared";

export class ConfigRef {
  constructor(private value: ReceiverConfig) {}

  get(): ReceiverConfig {
    return this.value;
  }

  set(value: ReceiverConfig): void {
    this.value = value;
  }
}

export async function reloadConfig(configRef: ConfigRef, configDir: string): Promise<ReceiverConfig> {
  const next = await loadReceiverConfig(configDir);
  configRef.set(next);
  return next;
}

export function disconnectUnauthorizedClients(broker: any, config: ReceiverConfig): number {
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
