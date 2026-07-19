import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
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
import { readonlyClientScript } from "./readonlyClient.js";
import { readonlyPage } from "./readonlyPage.js";

const require = createRequire(import.meta.url);
const jsonataBrowserScript = readFileSync(require.resolve("jsonata/jsonata.min.js"), "utf8");

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

function normalizeBasePath(value: string | undefined): string {
  const trimmed = value?.trim() ?? "";
  if (!trimmed || trimmed === "/") {
    return "";
  }

  const withLeadingSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return withLeadingSlash.replace(/\/+$/, "");
}

function routePaths(path: string, basePath: string): string[] {
  return basePath ? [path, `${basePath}${path}`] : [path];
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
  const basePath = normalizeBasePath(configRef.get().viewer.basePath);

  for (const path of routePaths("/health", basePath)) {
    app.get(path, async () => ({ ok: true }));
  }

  for (const path of routePaths("/assets/readonly-view.js", basePath)) {
    app.get(path, async (_request, reply) => {
      return reply
        .type("application/javascript; charset=utf-8")
        .send(readonlyClientScript);
    });
  }

  for (const path of routePaths("/assets/jsonata.min.js", basePath)) {
    app.get(path, async (_request, reply) => {
      return reply
        .type("application/javascript; charset=utf-8")
        .send(jsonataBrowserScript);
    });
  }

  for (const path of routePaths("/view/:device/:label", basePath)) {
    app.get<{
      Params: { device: string; label: string };
      Querystring: { token?: string };
    }>(path, async (request, reply) => {
      const { device, label } = request.params;
      const config = configRef.get();
      const token = tokenFromQuery(request.query);
      if (!(await canRead(config, device, label, token))) {
        return reply.code(403).type("text/plain; charset=utf-8").send("forbidden");
      }

      return reply
        .type("text/html; charset=utf-8")
        .send(readonlyPage(device, label, token, config.viewer.basePath));
    });
  }

  for (const path of routePaths("/api/view/:device/:label/metadata", basePath)) {
    app.get<{
      Params: { device: string; label: string };
      Querystring: { token?: string };
    }>(path, async (request, reply) => {
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
  }

  for (const path of routePaths("/api/view/:device/:label/history", basePath)) {
    app.get<{
      Params: { device: string; label: string };
      Querystring: { token?: string; from?: string; to?: string; extractor?: string };
    }>(path, async (request, reply) => {
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
  }

  for (const path of routePaths("/api/view/:device/:label/realtime", basePath)) {
    app.get<{
      Params: { device: string; label: string };
      Querystring: { token?: string };
    }>(path, async (request, reply) => {
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
      reply.raw.write(": connected\n\n");

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
  }

  return app;
}
