import net from "node:net";
import { createRequire } from "node:module";
import {
  AppConfig,
  canDevicePublish,
  createLogger,
  findDevice,
  isViewerClient,
  parseDataTopic,
  verifySecret,
  JsonValue,
} from "@iot-data-server/shared";
import { JsonlWriter } from "../storage/jsonlWriter.js";

type MutableConfig = {
  get(): AppConfig;
};

const require = createRequire(import.meta.url);
const aedesModule = require("aedes") as any;
const createAedesBroker = async (): Promise<any> => {
  if (aedesModule.Aedes?.createBroker) {
    return aedesModule.Aedes.createBroker();
  }
  if (typeof aedesModule === "function") {
    return aedesModule();
  }
  return (aedesModule.default ?? aedesModule.Aedes)();
};

function payloadSize(payload: unknown): number {
  if (Buffer.isBuffer(payload)) {
    return payload.byteLength;
  }
  if (typeof payload === "string") {
    return Buffer.byteLength(payload);
  }
  return Buffer.byteLength(String(payload ?? ""));
}

function parsePayload(payload: unknown): JsonValue {
  const text = Buffer.isBuffer(payload) ? payload.toString("utf8") : String(payload ?? "");
  return JSON.parse(text) as JsonValue;
}

export async function createBroker(configRef: MutableConfig, writer: JsonlWriter) {
  const broker = await createAedesBroker();
  const logger = createLogger(configRef.get()).child({ process: "receiver" });

  broker.authenticate = async (client: any, username: string | undefined, password: Buffer | undefined, callback: any) => {
    const config = configRef.get();
    const user = username ?? "";
    const pass = password?.toString("utf8") ?? "";

    if (isViewerClient(config, user, pass)) {
      client.role = "viewer";
      callback(null, true);
      return;
    }

    const device = findDevice(config, user);
    if (!device) {
      callback(null, false);
      return;
    }

    const accepted = await verifySecret(device, pass);
    if (accepted) {
      client.role = "device";
      client.deviceName = device.name;
    }
    callback(null, accepted);
  };

  broker.authorizePublish = (client: any, packet: any, callback: any) => {
    const config = configRef.get();

    if (client?.role !== "device" || !client.deviceName) {
      callback(new Error("publish is only allowed for authenticated devices"));
      return;
    }

    if (payloadSize(packet.payload) > config.mqtt.maxPayloadBytes) {
      callback(new Error("payload too large"));
      return;
    }

    if (!canDevicePublish(config, client.deviceName, packet.topic)) {
      callback(new Error("publish topic is not authorized"));
      return;
    }

    callback(null);
  };

  broker.authorizeSubscribe = (client: any, subscription: any, callback: any) => {
    if (client?.role === "viewer" && subscription.topic === "devices/+/data/+") {
      callback(null, subscription);
      return;
    }

    callback(new Error("subscribe topic is not authorized"));
  };

  broker.on("publish", (packet: any, client: any) => {
    if (client?.role !== "device") {
      return;
    }

    const parsed = parseDataTopic(packet.topic);
    if (!parsed) {
      return;
    }

    const receivedAt = new Date().toISOString();
    try {
      const data = parsePayload(packet.payload);
      void writer.append({
        receivedAt,
        device: parsed.device,
        label: parsed.label,
        topic: packet.topic,
        data,
      }).catch((error) => {
        logger.error({ error, topic: packet.topic }, "failed to write received record");
      });
    } catch (error) {
      logger.warn({ error, topic: packet.topic }, "received invalid JSON payload");
    }
  });

  const server = net.createServer(broker.handle);

  return {
    broker,
    server,
    async listen() {
      const config = configRef.get();
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(config.mqtt.port, config.mqtt.host, () => {
          server.off("error", reject);
          resolve();
        });
      });
      logger.info({ host: config.mqtt.host, port: config.mqtt.port }, "MQTT receiver started");
    },
    async close() {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      broker.close();
    },
  };
}
