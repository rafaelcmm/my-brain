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

/**
 * Parse and validate environment variables at startup.
 * Exits process with error code 1 if validation fails.
 */
export function loadEnvironment(): Environment {
  const requiredVars = [
    "MYBRAIN_WEB_SESSION_SECRET",
    "MYBRAIN_WEB_ORCHESTRATOR_URL",
    "MYBRAIN_INTERNAL_API_KEY",
    "MYBRAIN_WEB_PUBLIC_BASE_URL",
  ];

  const missing: string[] = [];
  for (const varName of requiredVars) {
    if (!process.env[varName]) {
      missing.push(varName);
    }
  }

  if (missing.length > 0) {
    console.error("Missing required environment variables:");
    missing.forEach((v) => console.error(`  ${v}`));
    process.exit(1);
  }

  const sessionSecret = process.env.MYBRAIN_WEB_SESSION_SECRET!;
  if (sessionSecret.length < 32) {
    console.error("MYBRAIN_WEB_SESSION_SECRET must be at least 32 characters");
    process.exit(1);
  }

  return {
    MYBRAIN_WEB_SESSION_SECRET: sessionSecret,
    MYBRAIN_WEB_ORCHESTRATOR_URL: process.env.MYBRAIN_WEB_ORCHESTRATOR_URL!,
    MYBRAIN_INTERNAL_API_KEY: process.env.MYBRAIN_INTERNAL_API_KEY!,
    MYBRAIN_WEB_RATE_LIMIT_LOGIN: parseInt(
      process.env.MYBRAIN_WEB_RATE_LIMIT_LOGIN || "5",
      10,
    ),
    MYBRAIN_WEB_PUBLIC_BASE_URL: process.env.MYBRAIN_WEB_PUBLIC_BASE_URL!,
    MYBRAIN_WEB_LOG_LEVEL: (process.env.MYBRAIN_WEB_LOG_LEVEL ||
      "info") as Environment["MYBRAIN_WEB_LOG_LEVEL"],
    NODE_ENV: (process.env.NODE_ENV ||
      "production") as Environment["NODE_ENV"],
  };
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
