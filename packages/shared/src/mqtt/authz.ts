import { AppConfig, LabelConfig } from "../config/schema.js";
import { parseDataTopic } from "./topics.js";

export function findDevice(config: AppConfig, deviceName: string) {
  return config.devices.find((device) => device.name === deviceName && device.enabled);
}

export function findEnabledLabel(config: AppConfig, deviceName: string, labelName: string) {
  const device = findDevice(config, deviceName);
  return device?.labels.find((label: LabelConfig) => label.name === labelName && label.enabled);
}

export function canDevicePublish(config: AppConfig, authenticatedDevice: string, topic: string): boolean {
  const parsed = parseDataTopic(topic);
  if (!parsed) {
    return false;
  }

  if (parsed.device !== authenticatedDevice) {
    return false;
  }

  return Boolean(findEnabledLabel(config, parsed.device, parsed.label));
}

export function isViewerClient(config: AppConfig, username: string, password: string): boolean {
  const mqtt = config.viewer.realtime.mqtt;
  return username === mqtt.username && password === mqtt.password;
}
