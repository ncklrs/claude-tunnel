import { LinearClient } from "@linear/sdk";
import { config } from "../../config";
import { logger } from "../../logger";
import type { Issue, IssueLabel, IssueComment, ParentIssue } from "../../types";
import type { IssueClient } from "../types";

/**
 * Linear issue client implementing the IssueClient interface
 *
 * Wraps the Linear SDK to provide a unified interface for issue operations.
 * Repository information comes from a custom field configured via REPO_CUSTOM_FIELD_NAME.
 */
export class LinearIssueClient implements IssueClient {
  readonly provider = "linear" as const;
  private client: LinearClient;

  constructor() {
    if (!config.linearApiKey) {
      throw new Error("LINEAR_API_KEY is required for Linear provider");
    }
    this.client = new LinearClient({ apiKey: config.linearApiKey });
  }

  /**
   * Fetch a label by ID to get its name
   */
  async getLabel(labelId: string): Promise<IssueLabel | null> {
    try {
      const label = await this.client.issueLabel(labelId);
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
   * Fetch an issue from Linear and convert to generic Issue format
   */
  async getIssue(issueId: string): Promise<Issue | null> {
    try {
      logger.debug(`Fetching issue ${issueId} from Linear`);

      const issue = await this.client.issue(issueId);
      if (!issue) {
        logger.warn(`Issue ${issueId} not found`);
        return null;
      }

      // Fetch labels
      const labelsConnection = await issue.labels();
      const labels: IssueLabel[] = labelsConnection.nodes.map((label) => ({
        id: label.id,
        name: label.name,
      }));

      // Fetch comments if configured
      let comments: IssueComment[] = [];
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

      // Fetch custom fields to get repository
      let repository: string | undefined;
      try {
        const team = await issue.team;
        if (team) {
          const rawIssue = issue as unknown as Record<string, unknown>;
          if (rawIssue.customFields && Array.isArray(rawIssue.customFields)) {
            for (const field of rawIssue.customFields) {
              if (typeof field === "object" && field !== null) {
                const f = field as Record<string, unknown>;
                if (f.name === config.repoCustomFieldName && f.value) {
                  repository = String(f.value);
                  break;
                }
              }
            }
          }
        }
      } catch (e) {
        logger.debug("Could not fetch custom fields", { error: String(e) });
      }

      // Fetch parent issue if exists
      let parent: ParentIssue | undefined;
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

      // Fetch state and team for metadata
      const state = await issue.state;
      const team = await issue.team;

      const genericIssue: Issue = {
        id: issue.id,
        identifier: issue.identifier,
        title: issue.title,
        description: issue.description ?? undefined,
        labels,
        comments,
        parent,
        repository,
        metadata: {
          state: state ? { id: state.id, name: state.name } : undefined,
          team: team ? { id: team.id, key: team.key } : undefined,
        },
      };

      logger.debug(`Fetched issue ${issue.identifier}: ${issue.title}`);
      return genericIssue;
    } catch (e) {
      logger.error(`Failed to fetch issue ${issueId}`, { error: String(e) });
      throw e;
    }
  }

  /**
   * Update the status of an issue by changing workflow state
   */
  async updateStatus(
    issueId: string,
    status: "in_progress" | "review"
  ): Promise<void> {
    const statusName =
      status === "in_progress" ? config.inProgressStatus : config.reviewStatus;

    try {
      logger.debug(`Updating issue ${issueId} status to "${statusName}"`);

      const issue = await this.client.issue(issueId);
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
  async addComment(issueId: string, body: string): Promise<void> {
    try {
      logger.debug(`Adding comment to issue ${issueId}`);

      await this.client.createComment({
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

  /**
   * Get repository from issue's repository field (populated from custom field)
   */
  getRepository(issue: Issue): string | null {
    return issue.repository ?? null;
  }

  /**
   * Branch name for Linear uses the issue identifier (e.g., "ENG-123")
   */
  getBranchName(issue: Issue): string {
    return issue.identifier;
  }
}
