export interface DataTopic {
  device: string;
  label: string;
}

const segmentPattern = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;

export function isSafeName(value: string): boolean {
  return segmentPattern.test(value);
}

export function parseDataTopic(topic: string): DataTopic | null {
  const parts = topic.split("/");
  if (parts.length !== 4) {
    return null;
  }

  const [root, device, type, label] = parts;
  if (root !== "devices" || type !== "data") {
    return null;
  }

  if (!isSafeName(device) || !isSafeName(label)) {
    return null;
  }

  return { device, label };
}

export function dataTopic(device: string, label: string): string {
  if (!isSafeName(device) || !isSafeName(label)) {
    throw new Error(`invalid topic segment: ${device}/${label}`);
  }
  return `devices/${device}/data/${label}`;
}
