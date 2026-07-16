import { createLogger, defaultConfigDir, loadConfig, watchConfig } from "@iot-data-server/shared";
import { ConfigRef, disconnectUnauthorizedClients, reloadConfig } from "./configReload.js";
import { createBroker } from "./broker/createBroker.js";
import { JsonlWriter } from "./storage/jsonlWriter.js";
import { cleanupRetention } from "./storage/retention.js";

async function main() {
  const configDir = defaultConfigDir();
  const initialConfig = await loadConfig(configDir);
  const configRef = new ConfigRef(initialConfig);
  const logger = createLogger(initialConfig).child({ process: "receiver" });
  const writer = new JsonlWriter(process.env.IOT_DATA_SERVER_DATA_DIR ?? initialConfig.storage.dataDir);
  const broker = await createBroker(configRef, writer);

  await broker.listen();

  const retentionTimer = setInterval(() => {
    const config = configRef.get();
    void cleanupRetention(process.env.IOT_DATA_SERVER_DATA_DIR ?? config.storage.dataDir, config.storage.retentionDays)
      .then((removed) => logger.info({ removed }, "retention cleanup completed"))
      .catch((error) => logger.error({ error }, "retention cleanup failed"));
  }, 60 * 60 * 1000);

  const closeWatcher = watchConfig(configDir, () => {
    void reloadConfig(configRef, configDir)
      .then((config) => {
        const disconnected = disconnectUnauthorizedClients(broker.broker, config);
        logger.info({ disconnected }, "configuration reloaded");
      })
      .catch((error) => logger.error({ error }, "configuration reload failed"));
  });

  const shutdown = async () => {
    logger.info("receiver shutting down");
    clearInterval(retentionTimer);
    await closeWatcher();
    await broker.close();
  };

  process.once("SIGINT", () => void shutdown().then(() => process.exit(0)));
  process.once("SIGTERM", () => void shutdown().then(() => process.exit(0)));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
