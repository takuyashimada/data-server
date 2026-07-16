import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { findConfigDir } from "./loader.js";

describe("findConfigDir", () => {
  it("finds the project config directory from a workspace package directory", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "iot-data-server-"));
    const configDir = path.join(root, "config");
    const packageDir = path.join(root, "packages", "receiver");

    await mkdir(configDir, { recursive: true });
    await mkdir(packageDir, { recursive: true });
    await writeFile(path.join(configDir, "server.example.yaml"), "");

    expect(findConfigDir(packageDir)).toBe(configDir);
  });
});
