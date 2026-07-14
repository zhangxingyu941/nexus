import { readFile } from "node:fs/promises";
import type { Pool } from "pg";
import { isWorkspacePayload } from "./workspaceStore";
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

  try {
    await workspaceStore.saveWorkspace(session.user.id, workspace);
  } finally {
    await authStore.deleteSession(session.token);
  }

  return {
    blockCount: workspace.documents.reduce((total, document) => total + document.blocks.length, 0),
    documentCount: workspace.documents.length,
    user: session.user,
  };
}
