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
 * Get an optional environment variable with a default
 */
function optional(name: string, defaultValue: string): string {
  return process.env[name] || defaultValue;
}

/**
 * Get an optional environment variable, returning undefined if not set
 */
function optionalOrUndefined(name: string): string | undefined {
  return process.env[name] || undefined;
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
  // Linear API - optional (only required if using Linear provider)
  linearApiKey: jsonConfig.linearApiKey || optionalOrUndefined("LINEAR_API_KEY"),
  linearWebhookSecret:
    jsonConfig.linearWebhookSecret || optionalOrUndefined("LINEAR_WEBHOOK_SECRET"),

  // Linear settings - optional with defaults
  linearTriggerLabel:
    jsonConfig.linearTriggerLabel || optional("LINEAR_TRIGGER_LABEL", optional("TRIGGER_LABEL", "ai-attempt")),
  repoCustomFieldName:
    jsonConfig.repoCustomFieldName ||
    optional("REPO_CUSTOM_FIELD_NAME", "Repository"),

  // GitHub API - optional (only required if using GitHub provider)
  githubToken: jsonConfig.githubToken || optionalOrUndefined("GITHUB_TOKEN"),
  githubWebhookSecret:
    jsonConfig.githubWebhookSecret || optionalOrUndefined("GITHUB_WEBHOOK_SECRET"),

  // GitHub settings - optional with defaults
  githubTriggerLabel:
    jsonConfig.githubTriggerLabel || optional("GITHUB_TRIGGER_LABEL", "ai-attempt"),
  githubInProgressLabel:
    jsonConfig.githubInProgressLabel || optional("GITHUB_IN_PROGRESS_LABEL", "in-progress"),
  githubReviewLabel:
    jsonConfig.githubReviewLabel || optional("GITHUB_REVIEW_LABEL", "review"),

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

  // Linear status mapping (used by Linear provider)
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
  const warnings: string[] = [];

  // At least one provider must be configured
  const hasLinear = config.linearApiKey && config.linearWebhookSecret;
  const hasGitHub = config.githubToken && config.githubWebhookSecret;

  if (!hasLinear && !hasGitHub) {
    errors.push(
      "At least one provider must be configured. Set either LINEAR_API_KEY + LINEAR_WEBHOOK_SECRET or GITHUB_TOKEN + GITHUB_WEBHOOK_SECRET"
    );
  }

  // Warn about partial configurations
  if (config.linearApiKey && !config.linearWebhookSecret) {
    warnings.push("LINEAR_API_KEY is set but LINEAR_WEBHOOK_SECRET is missing - Linear provider will not work");
  }
  if (!config.linearApiKey && config.linearWebhookSecret) {
    warnings.push("LINEAR_WEBHOOK_SECRET is set but LINEAR_API_KEY is missing - Linear provider will not work");
  }
  if (config.githubToken && !config.githubWebhookSecret) {
    warnings.push("GITHUB_TOKEN is set but GITHUB_WEBHOOK_SECRET is missing - GitHub provider will not work");
  }
  if (!config.githubToken && config.githubWebhookSecret) {
    warnings.push("GITHUB_WEBHOOK_SECRET is set but GITHUB_TOKEN is missing - GitHub provider will not work");
  }

  // Git paths are always required
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

  // Log warnings
  for (const warning of warnings) {
    console.warn(`Warning: ${warning}`);
  }

  if (errors.length > 0) {
    throw new Error(
      `Configuration errors:\n${errors.map((e) => `  - ${e}`).join("\n")}`
    );
  }
}
