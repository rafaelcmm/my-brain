import { z } from "zod";

/**
 * Validated server-side environment variables for the webapp.
 */
export interface Environment {
  MYBRAIN_WEB_SESSION_SECRET: string;
  MYBRAIN_WEB_ORCHESTRATOR_URL: string;
  MYBRAIN_INTERNAL_API_KEY: string;
  MYBRAIN_WEB_RATE_LIMIT_LOGIN: number;
  MYBRAIN_WEB_PUBLIC_BASE_URL: string;
  MYBRAIN_WEB_LOG_LEVEL: "trace" | "debug" | "info" | "warn" | "error";
  NODE_ENV: "development" | "production" | "test";
}

const environmentSchema = z.object({
  MYBRAIN_WEB_SESSION_SECRET: z.string().min(16),
  MYBRAIN_WEB_ORCHESTRATOR_URL: z.string().min(1),
  MYBRAIN_INTERNAL_API_KEY: z.string().min(1),
  MYBRAIN_WEB_PUBLIC_BASE_URL: z.string().min(1),
  MYBRAIN_WEB_RATE_LIMIT_LOGIN: z.coerce.number().int().positive().default(5),
  MYBRAIN_WEB_LOG_LEVEL: z
    .enum(["trace", "debug", "info", "warn", "error"])
    .default("info"),
  NODE_ENV: z.enum(["development", "production", "test"]).default("production"),
});

/**
 * Parse and validate environment variables.
 * Throws when required variables are missing or invalid.
 */
export function loadEnvironment(): Environment {
  const parsed = environmentSchema.safeParse(process.env);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid web environment: ${issues}`);
  }

  return parsed.data;
}

/**
 * Get validated environment variables (singleton).
 * Call loadEnvironment() at startup; use env() in code.
 */
let _env: Environment | undefined;

export function env(): Environment {
  if (!_env) {
    _env = loadEnvironment();
  }
  return _env;
}
