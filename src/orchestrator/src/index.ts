/**
 * Orchestrator entry point — delegates entirely to the TypeScript bootstrap.
 *
 * The legacy MJS shim (legacy-index.mjs) has been superseded by the typed
 * bootstrap in bootstrap/main.ts. This file is kept thin intentionally so
 * the module graph stays easy to trace.
 */
import "./bootstrap/main.js";
