import type { IssueProvider } from "../types";
import type { IssueClient } from "./types";
import { config } from "../config";
import { LinearIssueClient } from "./linear/client";
import { GitHubIssueClient } from "./github/client";

// Lazy-loaded client instances
let linearClient: IssueClient | null = null;
let githubClient: IssueClient | null = null;

/**
 * Get the appropriate issue client for a provider
 *
 * Clients are lazily instantiated on first use. This allows the application
 * to run with only one provider configured.
 *
 * @param provider - The issue provider to get a client for
 * @returns The configured client for that provider
 * @throws Error if the provider is not configured
 */
export function getClient(provider: IssueProvider): IssueClient {
  switch (provider) {
    case "linear":
      if (!linearClient) {
        if (!config.linearApiKey) {
          throw new Error(
            "Linear provider requested but LINEAR_API_KEY is not configured"
          );
        }
        linearClient = new LinearIssueClient();
      }
      return linearClient;

    case "github":
      if (!githubClient) {
        if (!config.githubToken) {
          throw new Error(
            "GitHub provider requested but GITHUB_TOKEN is not configured"
          );
        }
        githubClient = new GitHubIssueClient();
      }
      return githubClient;

    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}

/**
 * Check if a provider is configured and available
 */
export function isProviderConfigured(provider: IssueProvider): boolean {
  switch (provider) {
    case "linear":
      return !!config.linearApiKey && !!config.linearWebhookSecret;
    case "github":
      return !!config.githubToken && !!config.githubWebhookSecret;
    default:
      return false;
  }
}

/**
 * Get list of all configured providers
 */
export function getConfiguredProviders(): IssueProvider[] {
  const providers: IssueProvider[] = [];
  if (isProviderConfigured("linear")) providers.push("linear");
  if (isProviderConfigured("github")) providers.push("github");
  return providers;
}

// Re-export types
export type { IssueClient } from "./types";
