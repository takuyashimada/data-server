import { z } from "zod";

const nameSchema = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/);
const optionalSecretSchema = z.object({
  token: z.string().min(1).optional(),
  tokenHash: z.string().min(1).optional(),
});
const requiredSecretSchema = optionalSecretSchema.refine((value) => value.token || value.tokenHash, {
  message: "token or tokenHash is required",
});

export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(jsonValueSchema),
  ]),
);

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export const serverConfigSchema = z.object({
  server: z.object({
    logLevel: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  }).default({ logLevel: "info" }),
  mqtt: z.object({
    host: z.string().default("0.0.0.0"),
    port: z.number().int().positive().default(1883),
    tls: z.object({
      enabled: z.boolean().default(false),
      port: z.number().int().positive().default(8883),
      keyFile: z.string().default("./certs/server.key"),
      certFile: z.string().default("./certs/server.crt"),
    }).default({ enabled: false, port: 8883, keyFile: "./certs/server.key", certFile: "./certs/server.crt" }),
    maxPayloadBytes: z.number().int().positive().default(65536),
  }).default({ host: "0.0.0.0", port: 1883, maxPayloadBytes: 65536 }),
  storage: z.object({
    dataDir: z.string().default("./data"),
    rotation: z.literal("daily").default("daily"),
    dateMode: z.literal("utc").default("utc"),
    retentionDays: z.number().int().positive().default(62),
  }).default({ dataDir: "./data", rotation: "daily", dateMode: "utc", retentionDays: 62 }),
  viewer: z.object({
    host: z.string().default("0.0.0.0"),
    port: z.number().int().positive().default(3000),
    realtime: z.object({
      mqtt: z.object({
        url: z.string().url().or(z.string().startsWith("mqtt://")).or(z.string().startsWith("mqtts://")),
        username: z.string().min(1),
        password: z.string().min(1),
      }),
    }),
  }),
  admin: z.object({
    passwordHash: z.string().min(1),
  }),
});

export const labelConfigSchema = z.object({
  name: nameSchema,
  enabled: z.boolean().default(true),
  readonlyView: z.object({
    enabled: z.boolean().default(false),
  }).merge(optionalSecretSchema).default({ enabled: false }),
});

export const deviceConfigSchema = z.object({
  name: nameSchema,
  enabled: z.boolean().default(true),
  labels: z.array(labelConfigSchema).min(1),
}).and(requiredSecretSchema);

export const devicesConfigSchema = z.object({
  devices: z.array(deviceConfigSchema).default([]),
});

export const extractorConfigSchema = z.object({
  id: nameSchema,
  device: nameSchema,
  label: nameSchema,
  labelText: z.string().min(1),
  expression: z.string().min(1),
  valueType: z.enum(["number"]).default("number"),
  unit: z.string().optional(),
  enabled: z.boolean().default(true),
});

export const extractorsConfigSchema = z.object({
  extractors: z.array(extractorConfigSchema).default([]),
});

export const appConfigSchema = serverConfigSchema
  .merge(devicesConfigSchema)
  .merge(extractorsConfigSchema)
  .superRefine((config, ctx) => {
    const devices = new Set<string>();
    for (const device of config.devices) {
      if (devices.has(device.name)) {
        ctx.addIssue({ code: "custom", path: ["devices"], message: `duplicate device: ${device.name}` });
      }
      devices.add(device.name);

      const labels = new Set<string>();
      for (const label of device.labels) {
        if (labels.has(label.name)) {
          ctx.addIssue({
            code: "custom",
            path: ["devices", device.name, "labels"],
            message: `duplicate label for ${device.name}: ${label.name}`,
          });
        }
        labels.add(label.name);
      }
    }

    for (const extractor of config.extractors) {
      const device = config.devices.find((item) => item.name === extractor.device);
      const label = device?.labels.find((item: LabelConfig) => item.name === extractor.label);
      if (!device || !label) {
        ctx.addIssue({
          code: "custom",
          path: ["extractors", extractor.id],
          message: `unknown extractor target: ${extractor.device}/${extractor.label}`,
        });
      }
    }
  });

export type AppConfig = z.infer<typeof appConfigSchema>;
export type DeviceConfig = z.infer<typeof deviceConfigSchema>;
export type LabelConfig = z.infer<typeof labelConfigSchema>;
export type ExtractorConfig = z.infer<typeof extractorConfigSchema>;
