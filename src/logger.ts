import { appendFileSync, mkdirSync, existsSync } from "fs";
import { dirname, resolve } from "path";
import { config } from "./config";

type LogLevel = "error" | "warn" | "info" | "debug";

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

/**
 * Format a log message with timestamp, level, and optional context
 */
function formatMessage(
  level: LogLevel,
  message: string,
  context?: Record<string, unknown>
): string {
  const timestamp = new Date().toISOString();
  const contextStr = context ? ` ${JSON.stringify(context)}` : "";
  return `[${timestamp}] [${level.toUpperCase()}] ${message}${contextStr}`;
}

/**
 * Check if a log level should be output based on configured level
 */
function shouldLog(level: LogLevel): boolean {
  const configuredPriority = LOG_LEVEL_PRIORITY[config.logLevel];
  const messagePriority = LOG_LEVEL_PRIORITY[level];
  return messagePriority <= configuredPriority;
}

/**
 * Main logger for server-wide logging to stdout
 */
export const logger = {
  error(message: string, context?: Record<string, unknown>): void {
    if (shouldLog("error")) {
      console.error(formatMessage("error", message, context));
    }
  },

  warn(message: string, context?: Record<string, unknown>): void {
    if (shouldLog("warn")) {
      console.warn(formatMessage("warn", message, context));
    }
  },

  info(message: string, context?: Record<string, unknown>): void {
    if (shouldLog("info")) {
      console.log(formatMessage("info", message, context));
    }
  },

  debug(message: string, context?: Record<string, unknown>): void {
    if (shouldLog("debug")) {
      console.log(formatMessage("debug", message, context));
    }
  },
};

/**
 * Interface for issue-specific file logger
 */
export interface IssueLogger {
  error(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  debug(message: string, context?: Record<string, unknown>): void;
  getLogPath(): string;
}

/**
 * Create a logger that writes to a file for a specific issue
 * Also outputs to stdout for real-time visibility
 */
export function createIssueLogger(issueId: string): IssueLogger {
  const logDir = resolve(process.cwd(), "logs");
  const logPath = resolve(logDir, `${issueId}.log`);

  // Ensure logs directory exists
  if (!existsSync(logDir)) {
    mkdirSync(logDir, { recursive: true });
  }

  const writeToFile = (
    level: LogLevel,
    message: string,
    context?: Record<string, unknown>
  ): void => {
    const formatted = formatMessage(level, message, context);

    // Write to file
    try {
      appendFileSync(logPath, formatted + "\n");
    } catch (e) {
      logger.error(`Failed to write to log file ${logPath}`, {
        error: String(e),
      });
    }

    // Also output to stdout based on log level
    if (shouldLog(level)) {
      const prefix = `[${issueId}]`;
      switch (level) {
        case "error":
          console.error(`${prefix} ${formatted}`);
          break;
        case "warn":
          console.warn(`${prefix} ${formatted}`);
          break;
        default:
          console.log(`${prefix} ${formatted}`);
      }
    }
  };

  return {
    error(message: string, context?: Record<string, unknown>): void {
      writeToFile("error", message, context);
    },

    warn(message: string, context?: Record<string, unknown>): void {
      writeToFile("warn", message, context);
    },

    info(message: string, context?: Record<string, unknown>): void {
      writeToFile("info", message, context);
    },

    debug(message: string, context?: Record<string, unknown>): void {
      writeToFile("debug", message, context);
    },

    getLogPath(): string {
      return logPath;
    },
  };
}
