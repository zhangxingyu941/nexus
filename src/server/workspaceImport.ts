import { readFile } from "node:fs/promises";
import type { Pool } from "pg";
import { isWorkspacePayload } from "./workspacePayload";
import { PostgresAuthStore } from "./postgresAuthStore";
import { PostgresWorkspaceStore } from "./postgresWorkspaceStore";

interface ImportWorkspaceOptions {
  displayName: string;
  email: string;
  filePath: string;
}

export async function importWorkspaceFromFile(pool: Pool, options: ImportWorkspaceOptions) {
  const rawWorkspace = await readFile(options.filePath, "utf8");
  const workspace: unknown = JSON.parse(rawWorkspace);

  if (!isWorkspacePayload(workspace)) {
    throw new Error("工作区数据格式不正确");
  }

  const workspaceStore = new PostgresWorkspaceStore(pool);
  const authStore = new PostgresAuthStore(pool, workspaceStore);
  const session = await authStore.createSession({
    displayName: options.displayName,
    email: options.email,
  });
  const workspaceId = (await workspaceStore.listWorkspaces(session.user.id)).currentWorkspaceId;

  try {
    await workspaceStore.saveWorkspace(session.user.id, workspaceId, workspace);
  } finally {
    await authStore.deleteSession(session.token);
  }

  return {
    blockCount: workspace.documents.reduce((total, document) => total + document.blocks.length, 0),
    documentCount: workspace.documents.length,
    user: session.user,
    workspaceId,
  };
}
