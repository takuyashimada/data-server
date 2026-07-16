import { EventEmitter } from "node:events";
import mqtt, { MqttClient } from "mqtt";
import { AppConfig, parseDataTopic, StoredRecord } from "@iot-data-server/shared";

export class RealtimeSubscriber extends EventEmitter {
  private client: MqttClient | null = null;

  start(config: AppConfig): void {
    this.stop();
    const realtime = config.viewer.realtime.mqtt;
    this.client = mqtt.connect(realtime.url, {
      username: realtime.username,
      password: realtime.password,
    });

    this.client.on("connect", () => {
      this.client?.subscribe("devices/+/data/+");
    });

    this.client.on("message", (topic, payload) => {
      const parsed = parseDataTopic(topic);
      if (!parsed) {
        return;
      }

      try {
        const record: StoredRecord = {
          receivedAt: new Date().toISOString(),
          device: parsed.device,
          label: parsed.label,
          topic,
          data: JSON.parse(payload.toString("utf8")),
        };
        this.emit("record", record);
      } catch {
        // Invalid payloads are ignored in viewer. The receiver owns validation and storage.
      }
    });
  }

  stop(): void {
    this.client?.end(true);
    this.client = null;
  }
}
