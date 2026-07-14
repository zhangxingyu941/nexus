import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { EditorWorkspace } from "../features/editor/model/block";

export interface WorkspaceStore {
  loadWorkspace: () => Promise<EditorWorkspace | null>;
  saveWorkspace: (workspace: EditorWorkspace) => Promise<EditorWorkspace>;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isEditorDocument(value: unknown) {
  return (
    isObject(value) &&
    typeof value.id === "string" &&
    typeof value.title === "string" &&
    Array.isArray(value.blocks) &&
    typeof value.updatedAt === "number"
  );
}

export function isWorkspacePayload(value: unknown): value is EditorWorkspace {
  if (
    !isObject(value) ||
    !Array.isArray(value.documents) ||
    value.documents.length === 0 ||
    typeof value.activeDocumentId !== "string" ||
    typeof value.updatedAt !== "number"
  ) {
    return false;
  }

  return (
    value.documents.every((document) => isEditorDocument(document)) &&
    value.documents.some((document) => document.id === value.activeDocumentId)
  );
}

export function getWorkspaceDataFilePath() {
  return resolve(process.env.WORKSPACE_DATA_FILE ?? "server/data/workspace.json");
}

export function createFileWorkspaceStore(filePath = getWorkspaceDataFilePath()): WorkspaceStore {
  const workspaceFilePath = resolve(filePath);

  return {
    async loadWorkspace() {
      try {
        const rawWorkspace = await readFile(workspaceFilePath, "utf8");

        return JSON.parse(rawWorkspace) as EditorWorkspace;
      } catch (error) {
        if (isObject(error) && error.code === "ENOENT") {
          return null;
        }

        throw error;
      }
    },

    async saveWorkspace(workspace) {
      await mkdir(dirname(workspaceFilePath), { recursive: true });
      // 第一版直接保存整份工作区，方便之后迁数据库时保留清晰的数据边界。
      await writeFile(workspaceFilePath, `${JSON.stringify(workspace, null, 2)}\n`, "utf8");

      return workspace;
    },
  };
}
