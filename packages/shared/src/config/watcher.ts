import chokidar from "chokidar";
import path from "node:path";

export type ConfigFileName = "server.yaml" | "devices.yaml" | "extractors.yaml";

const allConfigFiles: ConfigFileName[] = ["server.yaml", "devices.yaml", "extractors.yaml"];

export function watchConfig(
  configDir: string,
  onChange: () => void,
  files: ConfigFileName[] = allConfigFiles,
): () => Promise<void> {
  const watcher = chokidar.watch(files.map((file) => path.join(configDir, file)), {
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 200,
      pollInterval: 50,
    },
  });

  watcher.on("add", onChange);
  watcher.on("change", onChange);

  return () => watcher.close();
}
