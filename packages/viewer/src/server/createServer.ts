import Fastify from "fastify";
import {
  AppConfig,
  createLogger,
  findEnabledLabel,
  resolveDataDir,
  verifySecret,
} from "@iot-data-server/shared";
import { RealtimeSubscriber } from "../mqtt/subscriber.js";
import { readRecords } from "../history/jsonlReader.js";
import { extractPoints } from "../history/extractor.js";

type ConfigRef = {
  get(): AppConfig;
  configDir: string;
};

function tokenFromQuery(query: unknown): string {
  if (query && typeof query === "object" && "token" in query) {
    const token = (query as { token?: unknown }).token;
    return typeof token === "string" ? token : "";
  }
  return "";
}

async function canRead(config: AppConfig, device: string, label: string, token: string): Promise<boolean> {
  const labelConfig = findEnabledLabel(config, device, label);
  if (!labelConfig?.readonlyView.enabled) {
    return false;
  }
  return verifySecret(labelConfig.readonlyView, token);
}

export function createServer(configRef: ConfigRef, subscriber: RealtimeSubscriber) {
  const app = Fastify({
    loggerInstance: createLogger(configRef.get()),
  });

  app.get("/health", async () => ({ ok: true }));

  app.get<{
    Params: { device: string; label: string };
    Querystring: { token?: string };
  }>("/api/view/:device/:label/metadata", async (request, reply) => {
    const { device, label } = request.params;
    const config = configRef.get();
    const token = tokenFromQuery(request.query);
    if (!(await canRead(config, device, label, token))) {
      return reply.code(403).send({ error: "forbidden" });
    }

    const extractors = config.extractors.filter((item) =>
      item.enabled && item.device === device && item.label === label);
    return { device, label, extractors };
  });

  app.get<{
    Params: { device: string; label: string };
    Querystring: { token?: string; from?: string; to?: string; extractor?: string };
  }>("/api/view/:device/:label/history", async (request, reply) => {
    const { device, label } = request.params;
    const config = configRef.get();
    const token = tokenFromQuery(request.query);
    if (!(await canRead(config, device, label, token))) {
      return reply.code(403).send({ error: "forbidden" });
    }

    const from = request.query.from ? new Date(request.query.from) : new Date(Date.now() - 60 * 60 * 1000);
    const to = request.query.to ? new Date(request.query.to) : new Date();
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      return reply.code(400).send({ error: "invalid date range" });
    }

    const dataDir = resolveDataDir(configRef.configDir, config.storage.dataDir);
    const records = await readRecords(dataDir, device, label, from, to);
    const extractor = config.extractors.find((item) =>
      item.enabled && item.device === device && item.label === label && item.id === request.query.extractor);

    if (!extractor) {
      return { records };
    }

    const points = await extractPoints(records, extractor);
    return { points };
  });

  app.get<{
    Params: { device: string; label: string };
    Querystring: { token?: string };
  }>("/api/view/:device/:label/realtime", async (request, reply) => {
    const { device, label } = request.params;
    const config = configRef.get();
    const token = tokenFromQuery(request.query);
    if (!(await canRead(config, device, label, token))) {
      return reply.code(403).send({ error: "forbidden" });
    }

    reply.raw.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });

    const onRecord = (record: unknown) => {
      const typed = record as { device: string; label: string };
      if (typed.device === device && typed.label === label) {
        reply.raw.write(`data: ${JSON.stringify(record)}\n\n`);
      }
    };

    subscriber.on("record", onRecord);
    request.raw.on("close", () => {
      subscriber.off("record", onRecord);
    });
  });

  return app;
}
