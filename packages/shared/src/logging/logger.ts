import pino from "pino";
import { AppConfig } from "../config/schema.js";

export function createLogger(config: Pick<AppConfig, "server">) {
  return pino({
    level: config.server.logLevel,
  });
}
