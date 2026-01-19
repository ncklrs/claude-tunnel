import { config as loadDotenv } from "dotenv";
import type { Config } from "./types";
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";

// Load .env file
loadDotenv();

/**
 * Load optional config.json overrides
 */
function loadConfigJson(): Partial<Config> {
  const configPath = resolve(process.cwd(), "config.json");
  if (existsSync(configPath)) {
    try {
      const content = readFileSync(configPath, "utf-8");
      return JSON.parse(content) as Partial<Config>;
    } catch (e) {
      console.warn(`Warning: Failed to parse config.json: ${e}`);
      return {};
    }
  }
  return {};
}

/**
 * Get a required environment variable, throw if missing
 */
function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}. ` +
        `Please set it in your .env file or environment.`
    );
  }
  return value;
}

/**
 * Get an optional environment variable with a default
 */
function optional(name: string, defaultValue: string): string {
  return process.env[name] || defaultValue;
}

/**
 * Parse a boolean from environment variable
 */
function parseBoolean(value: string): boolean {
  return value.toLowerCase() === "true" || value === "1";
}

/**
 * Parse log level with validation
 */
function parseLogLevel(value: string): Config["logLevel"] {
  const valid = ["error", "warn", "info", "debug"];
  if (valid.includes(value)) {
    return value as Config["logLevel"];
  }
  return "info";
}

// Load config.json overrides
const jsonConfig = loadConfigJson();

/**
 * Resolved configuration from environment variables, .env file, and config.json
 */
export const config: Config = {
  // Linear API - required
  linearApiKey: jsonConfig.linearApiKey || required("LINEAR_API_KEY"),
  linearWebhookSecret:
    jsonConfig.linearWebhookSecret || required("LINEAR_WEBHOOK_SECRET"),

  // Linear settings - optional with defaults
  triggerLabel:
    jsonConfig.triggerLabel || optional("TRIGGER_LABEL", "ai-attempt"),
  repoCustomFieldName:
    jsonConfig.repoCustomFieldName ||
    optional("REPO_CUSTOM_FIELD_NAME", "Repository"),

  // Git paths - required (no sensible default)
  reposBasePath:
    jsonConfig.reposBasePath ||
    optional("REPOS_BASE_PATH", "").replace("~", process.env.HOME || ""),
  worktreesPath:
    jsonConfig.worktreesPath ||
    optional("WORKTREES_PATH", "").replace("~", process.env.HOME || ""),

  // Agent settings
  maxConcurrentAgents:
    jsonConfig.maxConcurrentAgents ||
    parseInt(optional("MAX_CONCURRENT_AGENTS", "1"), 10),
  includeComments:
    jsonConfig.includeComments ??
    parseBoolean(optional("INCLUDE_COMMENTS", "true")),
  agentTimeout:
    jsonConfig.agentTimeout ||
    parseInt(optional("AGENT_TIMEOUT", "1800000"), 10), // 30 minutes default

  // Server
  port: jsonConfig.port || parseInt(optional("PORT", "3847"), 10),

  // Recovery
  autoCleanOrphans:
    jsonConfig.autoCleanOrphans ??
    parseBoolean(optional("AUTO_CLEAN_ORPHANS", "false")),

  // Linear status mapping
  inProgressStatus:
    jsonConfig.inProgressStatus || optional("IN_PROGRESS_STATUS", "In Progress"),
  reviewStatus:
    jsonConfig.reviewStatus || optional("REVIEW_STATUS", "In Review"),

  // Logging
  logLevel:
    jsonConfig.logLevel || parseLogLevel(optional("LOG_LEVEL", "info")),
};

/**
 * Validate configuration at startup
 */
export function validateConfig(): void {
  const errors: string[] = [];

  if (!config.linearApiKey) {
    errors.push("LINEAR_API_KEY is required");
  }

  if (!config.linearWebhookSecret) {
    errors.push("LINEAR_WEBHOOK_SECRET is required");
  }

  if (!config.reposBasePath) {
    errors.push(
      "REPOS_BASE_PATH is required (base directory where repositories are located)"
    );
  }

  if (!config.worktreesPath) {
    errors.push(
      "WORKTREES_PATH is required (directory where worktrees will be created)"
    );
  }

  if (errors.length > 0) {
    throw new Error(
      `Configuration errors:\n${errors.map((e) => `  - ${e}`).join("\n")}`
    );
  }
}
