import { EventEmitter } from "node:events";
import mqtt, { MqttClient } from "mqtt";
import { AppConfig, extractMeasuredAt, findEnabledLabel, parseDataTopic, StoredRecord } from "@iot-data-server/shared";

type RealtimeLogger = {
  debug(bindings: Record<string, unknown>, message: string): void;
  info(bindings: Record<string, unknown>, message: string): void;
  warn(bindings: Record<string, unknown>, message: string): void;
};

export class RealtimeSubscriber extends EventEmitter {
  private client: MqttClient | null = null;

  constructor(private readonly logger?: RealtimeLogger) {
    super();
  }

  start(config: AppConfig): void {
    this.stop();
    const realtime = config.viewer.realtime.mqtt;
    this.logger?.info({
      url: realtime.url,
      username: realtime.username,
    }, "viewer MQTT subscriber connecting");
    this.client = mqtt.connect(realtime.url, {
      username: realtime.username,
      password: realtime.password,
    });

    this.client.on("connect", () => {
      this.logger?.info({ url: realtime.url }, "viewer MQTT subscriber connected");
      this.client?.subscribe("devices/+/data/+", (error, subscriptions) => {
        if (error) {
          this.logger?.warn({ error }, "viewer MQTT subscriber subscribe failed");
          return;
        }
        this.logger?.info({ subscriptions }, "viewer MQTT subscriber subscribed");
      });
    });

    this.client.on("reconnect", () => {
      this.logger?.warn({ url: realtime.url }, "viewer MQTT subscriber reconnecting");
    });

    this.client.on("offline", () => {
      this.logger?.warn({ url: realtime.url }, "viewer MQTT subscriber offline");
    });

    this.client.on("error", (error) => {
      this.logger?.warn({ error, url: realtime.url }, "viewer MQTT subscriber error");
    });

    this.client.on("message", (topic, payload) => {
      const parsed = parseDataTopic(topic);
      if (!parsed) {
        return;
      }

      try {
        const data = JSON.parse(payload.toString("utf8"));
        const labelConfig = findEnabledLabel(config, parsed.device, parsed.label);
        const measuredAt = labelConfig ? extractMeasuredAt(data, labelConfig) : undefined;
        const record: StoredRecord = {
          receivedAt: new Date().toISOString(),
          ...(measuredAt ? { measuredAt } : {}),
          device: parsed.device,
          label: parsed.label,
          topic,
          data,
        };
        this.logger?.debug({ topic, device: parsed.device, label: parsed.label }, "viewer MQTT subscriber received record");
        this.emit("record", record);
      } catch (error) {
        this.logger?.debug({ error, topic }, "viewer MQTT subscriber ignored invalid payload");
        // Invalid payloads are ignored in viewer. The receiver owns validation and storage.
      }
    });
  }

  stop(): void {
    this.client?.end(true);
    this.client = null;
  }
}
