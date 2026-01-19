import { startServer } from "./server";
import { logger } from "./logger";

logger.info("Linear Agent starting...");

// Start the HTTP server (handles initialization, recovery, and processor)
await startServer();
