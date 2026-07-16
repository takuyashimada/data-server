import { AppConfig, createLogger, defaultConfigDir, loadConfig, watchConfig } from "@iot-data-server/shared";
import { RealtimeSubscriber } from "./mqtt/subscriber.js";
import { createServer } from "./server/createServer.js";

class ConfigRef {
  constructor(private value: AppConfig, readonly configDir: string) {}

  get(): AppConfig {
    return this.value;
  }

  set(value: AppConfig): void {
    this.value = value;
  }
}

async function main() {
  const configDir = defaultConfigDir();
  const initialConfig = await loadConfig(configDir);
  const configRef = new ConfigRef(initialConfig, configDir);
  const logger = createLogger(initialConfig).child({ process: "viewer" });
  const subscriber = new RealtimeSubscriber();
  subscriber.start(initialConfig);

  const app = createServer(configRef, subscriber);
  await app.listen({ host: initialConfig.viewer.host, port: initialConfig.viewer.port });

  const closeWatcher = watchConfig(configDir, () => {
    void loadConfig(configDir)
      .then((config) => {
        configRef.set(config);
        subscriber.start(config);
        logger.info("configuration reloaded");
      })
      .catch((error) => logger.error({ error }, "configuration reload failed"));
  });

  const shutdown = async () => {
    logger.info("viewer shutting down");
    await closeWatcher();
    subscriber.stop();
    await app.close();
  };

  process.once("SIGINT", () => void shutdown().then(() => process.exit(0)));
  process.once("SIGTERM", () => void shutdown().then(() => process.exit(0)));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
