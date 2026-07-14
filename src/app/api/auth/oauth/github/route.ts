import { NextResponse } from "next/server";
import { createGitHubOAuthService } from "../../../../../server/githubOAuth";
import { createGitHubStartRouteHandler } from "./handlers";

export async function GET(request: Request) {
  const oauth = createGitHubOAuthService();
  if (!oauth) {
    return NextResponse.json({ error: "GitHub 登录未配置" }, { status: 404 });
  }
  return createGitHubStartRouteHandler(oauth)(request);
}
