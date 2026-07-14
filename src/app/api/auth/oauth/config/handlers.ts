import { getGitHubOAuthConfig } from "../../../../../server/githubOAuth";

export function getOAuthProviderConfiguration(
  environment: Record<string, string | undefined> = process.env,
) {
  return { github: Boolean(getGitHubOAuthConfig(environment)) };
}
