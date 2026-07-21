import {
  CodeChallengeMethod,
  generateCodeVerifier,
  generateState,
  OAuth2Client,
} from "arctic";

const GITHUB_AUTHORIZE_ENDPOINT = "https://github.com/login/oauth/authorize";
const GITHUB_TOKEN_ENDPOINT = "https://github.com/login/oauth/access_token";
const GITHUB_API_BASE = "https://api.github.com";

export interface GitHubOAuthProfile {
  displayName: string;
  email: string;
  provider: "github";
  providerAccountId: string;
}

interface GitHubOAuthTokens {
  accessToken(): string;
}

interface GitHubOAuthClient {
  createAuthorizationURL(state: string, codeVerifier: string, scopes: string[]): URL;
  validateAuthorizationCode(code: string, codeVerifier: string): Promise<GitHubOAuthTokens>;
}

interface GitHubOAuthServiceOptions {
  client: GitHubOAuthClient;
  codeVerifierFactory: () => string;
  fetch: typeof fetch;
  stateFactory: () => string;
}

export class GitHubOAuthService {
  constructor(private readonly options: GitHubOAuthServiceOptions) {}

  createAuthorization() {
    const state = this.options.stateFactory();
    const codeVerifier = this.options.codeVerifierFactory();
    const url = this.options.client.createAuthorizationURL(
      state,
      codeVerifier,
      ["read:user", "user:email"],
    );

    return { codeVerifier, state, url: url.toString() };
  }

  async exchange(code: string, codeVerifier: string): Promise<GitHubOAuthProfile> {
    const tokens = await this.options.client.validateAuthorizationCode(code, codeVerifier);
    const headers = {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${tokens.accessToken()}`,
      "User-Agent": "nexus",
      "X-GitHub-Api-Version": "2022-11-28",
    };
    const [userResponse, emailsResponse] = await Promise.all([
      this.options.fetch(`${GITHUB_API_BASE}/user`, { headers }),
      this.options.fetch(`${GITHUB_API_BASE}/user/emails`, { headers }),
    ]);
    if (!userResponse.ok || !emailsResponse.ok) {
      throw new Error("无法读取 GitHub 账号信息");
    }

    const user = await userResponse.json() as { id?: unknown; login?: unknown; name?: unknown };
    const emails = await emailsResponse.json() as Array<{
      email?: unknown;
      primary?: unknown;
      verified?: unknown;
    }>;
    const verifiedEmails = Array.isArray(emails)
      ? emails.filter((email) => email.verified === true && typeof email.email === "string")
      : [];
    const email = verifiedEmails.find((candidate) => candidate.primary === true) ?? verifiedEmails[0];

    if (!email || (typeof user.id !== "number" && typeof user.id !== "string")) {
      throw new Error("GitHub 账号没有已验证邮箱");
    }

    const login = typeof user.login === "string" ? user.login.trim() : "";
    const displayName = typeof user.name === "string" && user.name.trim() ? user.name.trim() : login;
    if (!displayName) {
      throw new Error("GitHub 账号信息不完整");
    }

    return {
      displayName: displayName.slice(0, 80),
      email: String(email.email).trim().toLowerCase(),
      provider: "github",
      providerAccountId: String(user.id),
    };
  }
}

export function getGitHubOAuthConfig(environment: Record<string, string | undefined> = process.env) {
  const clientId = environment.GITHUB_CLIENT_ID?.trim();
  const clientSecret = environment.GITHUB_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    return null;
  }

  const appUrl = (environment.APP_URL?.trim() || "http://localhost:3000").replace(/\/+$/, "");
  return {
    clientId,
    clientSecret,
    redirectUri: `${appUrl}/api/auth/oauth/github/callback`,
  };
}

export function createGitHubOAuthService(
  environment: Record<string, string | undefined> = process.env,
) {
  const config = getGitHubOAuthConfig(environment);
  if (!config) {
    return null;
  }

  const client = new OAuth2Client(config.clientId, config.clientSecret, config.redirectUri);
  const adapter: GitHubOAuthClient = {
    createAuthorizationURL(state, codeVerifier, scopes) {
      return client.createAuthorizationURLWithPKCE(
        GITHUB_AUTHORIZE_ENDPOINT,
        state,
        CodeChallengeMethod.S256,
        codeVerifier,
        scopes,
      );
    },
    validateAuthorizationCode(code, codeVerifier) {
      return client.validateAuthorizationCode(GITHUB_TOKEN_ENDPOINT, code, codeVerifier);
    },
  };

  return new GitHubOAuthService({
    client: adapter,
    codeVerifierFactory: generateCodeVerifier,
    fetch,
    stateFactory: generateState,
  });
}
