import { LinearClient } from "@linear/sdk";
import { config } from "../config";
import { logger } from "../logger";
import type {
  LinearIssue,
  LinearLabel,
  LinearComment,
  LinearCustomField,
  LinearParentIssue,
} from "../types";

// Initialize the Linear client with API key
const client = new LinearClient({ apiKey: config.linearApiKey });

/**
 * Fetch a label by ID to get its name
 */
async function fetchLabel(labelId: string): Promise<LinearLabel | null> {
  try {
    const label = await client.issueLabel(labelId);
    return {
      id: label.id,
      name: label.name,
    };
  } catch (e) {
    logger.warn(`Failed to fetch label ${labelId}`, { error: String(e) });
    return null;
  }
}

/**
 * Fetch full issue details from Linear
 */
export async function getIssue(issueId: string): Promise<LinearIssue | null> {
  try {
    logger.debug(`Fetching issue ${issueId} from Linear`);

    const issue = await client.issue(issueId);

    if (!issue) {
      logger.warn(`Issue ${issueId} not found`);
      return null;
    }

    // Fetch labels
    const labelsConnection = await issue.labels();
    const labels: LinearLabel[] = labelsConnection.nodes.map((label) => ({
      id: label.id,
      name: label.name,
    }));

    // Fetch comments if configured
    let comments: LinearComment[] = [];
    if (config.includeComments) {
      const commentsConnection = await issue.comments();
      comments = await Promise.all(
        commentsConnection.nodes.map(async (comment) => {
          const user = await comment.user;
          return {
            id: comment.id,
            body: comment.body,
            createdAt: comment.createdAt.toISOString(),
            user: user ? { name: user.name } : undefined,
          };
        })
      );
      // Sort by created date (oldest first)
      comments.sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      );
    }

    // Fetch custom fields (including Repository field)
    const customFields: LinearCustomField[] = [];
    try {
      // Get the team to access custom fields
      const team = await issue.team;
      if (team) {
        // Fetch issue with custom field values through the API
        // Note: Linear SDK doesn't have direct custom field support,
        // we need to use the GraphQL query
        const issueWithFields = await client.issue(issueId);

        // Try to get custom field values from the raw data
        // This is a workaround since the SDK doesn't expose custom fields directly
        const rawIssue = issueWithFields as unknown as Record<string, unknown>;

        // Check for repository field in various places
        if (rawIssue.customFields && Array.isArray(rawIssue.customFields)) {
          for (const field of rawIssue.customFields) {
            if (typeof field === "object" && field !== null) {
              const f = field as Record<string, unknown>;
              customFields.push({
                name: String(f.name || ""),
                value: f.value != null ? String(f.value) : null,
              });
            }
          }
        }
      }
    } catch (e) {
      logger.debug("Could not fetch custom fields", { error: String(e) });
    }

    // Fetch parent issue if exists
    let parent: LinearParentIssue | undefined;
    try {
      const parentIssue = await issue.parent;
      if (parentIssue) {
        parent = {
          id: parentIssue.id,
          identifier: parentIssue.identifier,
          title: parentIssue.title,
          description: parentIssue.description ?? undefined,
        };
      }
    } catch (e) {
      logger.debug("Could not fetch parent issue", { error: String(e) });
    }

    // Fetch state
    const state = await issue.state;
    const team = await issue.team;

    const linearIssue: LinearIssue = {
      id: issue.id,
      identifier: issue.identifier,
      title: issue.title,
      description: issue.description ?? undefined,
      labels,
      comments,
      customFields,
      parent,
      state: state
        ? {
            id: state.id,
            name: state.name,
          }
        : undefined,
      team: team
        ? {
            id: team.id,
            key: team.key,
          }
        : undefined,
    };

    logger.debug(`Fetched issue ${issue.identifier}: ${issue.title}`);
    return linearIssue;
  } catch (e) {
    logger.error(`Failed to fetch issue ${issueId}`, { error: String(e) });
    throw e;
  }
}

/**
 * Get the repository value from an issue's custom fields
 */
export function getRepositoryFromIssue(issue: LinearIssue): string | null {
  const repoField = issue.customFields.find(
    (f) => f.name === config.repoCustomFieldName
  );
  return repoField?.value ?? null;
}

/**
 * Fetch a label by ID
 */
export async function getLabel(labelId: string): Promise<LinearLabel | null> {
  return fetchLabel(labelId);
}

/**
 * Check if a label with the given name exists in the labels array
 */
export function hasLabel(labels: LinearLabel[], labelName: string): boolean {
  return labels.some(
    (label) => label.name.toLowerCase() === labelName.toLowerCase()
  );
}

/**
 * Update the status of an issue by finding the workflow state by name
 */
export async function updateIssueStatus(
  issueId: string,
  statusName: string
): Promise<void> {
  try {
    logger.debug(`Updating issue ${issueId} status to "${statusName}"`);

    // First, fetch the issue to get its team
    const issue = await client.issue(issueId);
    if (!issue) {
      throw new Error(`Issue ${issueId} not found`);
    }

    const team = await issue.team;
    if (!team) {
      throw new Error(`Issue ${issueId} has no team`);
    }

    // Fetch workflow states for the team
    const states = await team.states();
    const targetState = states.nodes.find(
      (state) => state.name.toLowerCase() === statusName.toLowerCase()
    );

    if (!targetState) {
      const availableStates = states.nodes.map((s) => s.name).join(", ");
      throw new Error(
        `Status "${statusName}" not found for team ${team.key}. Available: ${availableStates}`
      );
    }

    // Update the issue's state
    await issue.update({ stateId: targetState.id });
    logger.info(`Updated issue ${issueId} status to "${statusName}"`);
  } catch (e) {
    logger.error(`Failed to update issue ${issueId} status`, {
      error: String(e),
    });
    throw e;
  }
}

/**
 * Add a comment to an issue
 */
export async function addComment(issueId: string, body: string): Promise<void> {
  try {
    logger.debug(`Adding comment to issue ${issueId}`);

    await client.createComment({
      issueId,
      body,
    });

    logger.info(`Added comment to issue ${issueId}`);
  } catch (e) {
    logger.error(`Failed to add comment to issue ${issueId}`, {
      error: String(e),
    });
    throw e;
  }
}
