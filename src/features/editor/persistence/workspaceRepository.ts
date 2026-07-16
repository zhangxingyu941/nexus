import type { WorkspaceCatalog, WorkspaceSnapshot, WorkspaceSummary } from "../../../shared/workspace";
import type { EditorWorkspace } from "../model/block";

export interface WorkspaceRepository {
  readonly target: "local" | "remote";
  list(): Promise<WorkspaceCatalog>;
  load(workspaceId: string): Promise<WorkspaceSnapshot>;
  create(name: string): Promise<WorkspaceSnapshot>;
  rename(workspaceId: string, name: string): Promise<WorkspaceSummary>;
  select(workspaceId: string): Promise<WorkspaceSnapshot>;
  save(workspaceId: string, content: EditorWorkspace): Promise<void>;
}
