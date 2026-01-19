import { Hono } from "hono";
import { config } from "./config";
import { logger } from "./logger";
import * as queue from "./services/queue";
import { webhook } from "./routes/webhook";
import { retry } from "./routes/retry";
import { startProcessor } from "./services/processor";
import { loadState } from "./services/state";
import { cleanupOrphanWorktrees } from "./services/git";

const app = new Hono();

// Mount routes
app.route("/webhook", webhook);
app.route("/retry", retry);

// Track server start time for uptime calculation
const startTime = Date.now();

/**
 * Health check endpoint
 */
app.get("/health", (c) => {
  return c.json({
    status: "ok",
    uptime: Math.floor((Date.now() - startTime) / 1000),
  });
});

/**
 * Status endpoint showing queue and running agents
 */
app.get("/status", (c) => {
  const status = queue.getStatus();
  return c.json(status);
});

/**
 * Initialize the server - handle recovery and cleanup
 */
async function initialize(): Promise<void> {
  // Load any previously running tasks
  const previousTasks = loadState();
  if (previousTasks.length > 0) {
    logger.warn(`Found ${previousTasks.length} incomplete tasks from previous run`);
    // Restore them to the queue for processing
    queue.restoreRunningTasks(previousTasks);
  }

  // Clean up orphan worktrees
  await cleanupOrphanWorktrees(queue.getRunningTasks());

  // Start the queue processor
  startProcessor();
}

/**
 * Start the HTTP server
 */
export async function startServer(): Promise<void> {
  // Initialize recovery and processor
  await initialize();

  const server = Bun.serve({
    port: config.port,
    fetch: app.fetch,
  });

  logger.info(`Linear Agent server started on port ${server.port}`);
}

/**
 * Export the Hono app for route registration
 */
export { app };
