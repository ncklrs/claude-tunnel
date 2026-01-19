import { existsSync, readFileSync, writeFileSync, renameSync } from "fs";
import { resolve } from "path";
import { logger } from "../logger";
import type { AgentTask, PersistedState } from "../types";

const STATE_FILE = resolve(process.cwd(), "state.json");
const STATE_TEMP = resolve(process.cwd(), "state.json.tmp");

/**
 * Save the current running agents state to disk
 * Uses atomic write (temp file + rename) to prevent corruption
 */
export async function saveState(runningAgents: AgentTask[]): Promise<void> {
  const state: PersistedState = {
    runningAgents,
    savedAt: new Date().toISOString(),
  };

  try {
    const content = JSON.stringify(state, null, 2);

    // Write to temp file first
    writeFileSync(STATE_TEMP, content, "utf-8");

    // Atomic rename
    renameSync(STATE_TEMP, STATE_FILE);

    logger.debug("State saved", { agentCount: runningAgents.length });
  } catch (e) {
    logger.error("Failed to save state", { error: String(e) });
  }
}

/**
 * Load the persisted state from disk
 * Returns empty array if no state file or parse error
 */
export function loadState(): AgentTask[] {
  if (!existsSync(STATE_FILE)) {
    logger.debug("No state file found");
    return [];
  }

  try {
    const content = readFileSync(STATE_FILE, "utf-8");
    const state = JSON.parse(content) as PersistedState;

    // Convert date strings back to Date objects
    const tasks = state.runningAgents.map((task) => ({
      ...task,
      startedAt: task.startedAt ? new Date(task.startedAt) : undefined,
    }));

    logger.info(`Loaded ${tasks.length} tasks from state file`, {
      savedAt: state.savedAt,
    });

    return tasks;
  } catch (e) {
    logger.error("Failed to load state", { error: String(e) });
    return [];
  }
}

/**
 * Clear the state file
 */
export function clearState(): void {
  try {
    if (existsSync(STATE_FILE)) {
      writeFileSync(STATE_FILE, JSON.stringify({ runningAgents: [], savedAt: new Date().toISOString() }));
      logger.debug("State cleared");
    }
  } catch (e) {
    logger.error("Failed to clear state", { error: String(e) });
  }
}

/**
 * Check if there are incomplete tasks from a previous run
 */
export function hasIncompleteTasks(): boolean {
  const tasks = loadState();
  return tasks.length > 0;
}
