import { logger } from "../logger";
import { config } from "../config";
import { existsSync, readdirSync, rmSync } from "fs";
import { resolve, basename } from "path";
import type { AgentTask } from "../types";

interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * Run a command and return the result
 */
async function runCommand(
  command: string[],
  cwd: string
): Promise<CommandResult> {
  const proc = Bun.spawn(command, {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  return { exitCode, stdout, stderr };
}

/**
 * Create a git worktree for an issue
 */
export async function createWorktree(
  repoPath: string,
  worktreePath: string,
  branchName: string
): Promise<void> {
  logger.debug(`Creating worktree at ${worktreePath} for branch ${branchName}`);

  // Check if worktree already exists
  if (existsSync(worktreePath)) {
    logger.info(`Worktree already exists at ${worktreePath}, will reuse`);
    return;
  }

  // Create the worktree with a new branch
  const result = await runCommand(
    ["git", "worktree", "add", worktreePath, "-b", branchName],
    repoPath
  );

  if (result.exitCode !== 0) {
    // Check if branch already exists, try without -b flag
    if (result.stderr.includes("already exists")) {
      logger.debug("Branch already exists, trying to checkout existing branch");
      const retryResult = await runCommand(
        ["git", "worktree", "add", worktreePath, branchName],
        repoPath
      );

      if (retryResult.exitCode !== 0) {
        throw new Error(
          `Failed to create worktree: ${retryResult.stderr || retryResult.stdout}`
        );
      }
      return;
    }

    throw new Error(
      `Failed to create worktree: ${result.stderr || result.stdout}`
    );
  }

  logger.info(`Created worktree at ${worktreePath}`);
}

/**
 * Remove a git worktree
 */
export async function removeWorktree(worktreePath: string): Promise<void> {
  logger.debug(`Removing worktree at ${worktreePath}`);

  // Find the repo this worktree belongs to
  // The worktree's .git file contains the path to the main repo
  if (!existsSync(worktreePath)) {
    logger.debug("Worktree does not exist, nothing to remove");
    return;
  }

  // Use git worktree remove from any repo that might know about it
  // We'll try to find the parent repo from the worktree's .git file
  const result = await runCommand(
    ["git", "worktree", "remove", worktreePath, "--force"],
    worktreePath
  );

  if (result.exitCode !== 0) {
    // If git worktree remove fails, try manual cleanup
    logger.warn(`git worktree remove failed, attempting manual cleanup`, {
      error: result.stderr,
    });

    try {
      rmSync(worktreePath, { recursive: true, force: true });
      logger.info(`Manually removed worktree directory at ${worktreePath}`);
    } catch (e) {
      throw new Error(`Failed to remove worktree: ${e}`);
    }
  } else {
    logger.info(`Removed worktree at ${worktreePath}`);
  }
}

/**
 * Check if a worktree has uncommitted changes
 */
export async function hasChanges(worktreePath: string): Promise<boolean> {
  const result = await runCommand(
    ["git", "status", "--porcelain"],
    worktreePath
  );

  if (result.exitCode !== 0) {
    throw new Error(`Failed to check git status: ${result.stderr}`);
  }

  return result.stdout.trim().length > 0;
}

/**
 * Stage all changes and commit
 */
export async function commitChanges(
  worktreePath: string,
  message: string
): Promise<void> {
  // Stage all changes
  const addResult = await runCommand(["git", "add", "-A"], worktreePath);

  if (addResult.exitCode !== 0) {
    throw new Error(`Failed to stage changes: ${addResult.stderr}`);
  }

  // Commit
  const commitResult = await runCommand(
    ["git", "commit", "-m", message],
    worktreePath
  );

  if (commitResult.exitCode !== 0) {
    // Check if it's just "nothing to commit"
    if (commitResult.stdout.includes("nothing to commit")) {
      logger.debug("Nothing to commit");
      return;
    }
    throw new Error(`Failed to commit: ${commitResult.stderr || commitResult.stdout}`);
  }

  logger.info(`Committed changes: ${message}`);
}

/**
 * Push branch to origin
 */
export async function pushBranch(
  worktreePath: string,
  branchName: string
): Promise<void> {
  const result = await runCommand(
    ["git", "push", "-u", "origin", branchName],
    worktreePath
  );

  if (result.exitCode !== 0) {
    throw new Error(`Failed to push branch: ${result.stderr || result.stdout}`);
  }

  logger.info(`Pushed branch ${branchName} to origin`);
}

/**
 * Create a pull request using GitHub CLI
 * Returns the PR URL or null if creation failed
 */
export async function createPR(
  worktreePath: string,
  title: string,
  body: string,
  baseBranch: string = "main"
): Promise<string | null> {
  const result = await runCommand(
    [
      "gh",
      "pr",
      "create",
      "--title",
      title,
      "--body",
      body,
      "--base",
      baseBranch,
    ],
    worktreePath
  );

  if (result.exitCode !== 0) {
    logger.warn("Failed to create PR", {
      error: result.stderr || result.stdout,
    });
    return null;
  }

  // gh pr create outputs the PR URL
  const prUrl = result.stdout.trim();
  logger.info(`Created PR: ${prUrl}`);
  return prUrl;
}

/**
 * Clean up orphaned worktrees
 * Returns list of removed worktree paths
 */
export async function cleanupOrphanWorktrees(
  runningTasks: AgentTask[]
): Promise<string[]> {
  const worktreesPath = config.worktreesPath;

  if (!existsSync(worktreesPath)) {
    logger.debug("Worktrees directory does not exist");
    return [];
  }

  const runningPaths = new Set(runningTasks.map((t) => t.worktreePath));
  const entries = readdirSync(worktreesPath, { withFileTypes: true });
  const orphans: string[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const fullPath = resolve(worktreesPath, entry.name);

    // Skip if this worktree has a running agent
    if (runningPaths.has(fullPath)) {
      logger.debug(`Worktree ${entry.name} has active agent, skipping`);
      continue;
    }

    orphans.push(fullPath);
  }

  if (orphans.length === 0) {
    logger.debug("No orphan worktrees found");
    return [];
  }

  logger.info(`Found ${orphans.length} orphan worktree(s)`);

  if (config.autoCleanOrphans) {
    for (const orphanPath of orphans) {
      try {
        await removeWorktree(orphanPath);
        logger.info(`Cleaned up orphan worktree: ${basename(orphanPath)}`);
      } catch (e) {
        logger.error(`Failed to clean up orphan worktree: ${orphanPath}`, {
          error: String(e),
        });
      }
    }
  } else {
    logger.info(
      "Auto-cleanup disabled. Orphan worktrees:\n" +
        orphans.map((p) => `  - ${basename(p)}`).join("\n")
    );
  }

  return orphans;
}
