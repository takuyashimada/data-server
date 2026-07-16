import chokidar from "chokidar";
import path from "node:path";

export function watchConfig(configDir: string, onChange: () => void): () => Promise<void> {
  const watcher = chokidar.watch([
    path.join(configDir, "server.yaml"),
    path.join(configDir, "devices.yaml"),
    path.join(configDir, "extractors.yaml"),
  ], {
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
