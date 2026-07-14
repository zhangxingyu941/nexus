export type {
  CreateWorkspaceDocumentInput,
  StoredBlock,
  StoredBlockComment,
  StoredDocument,
  StoredWorkspace,
  WorkspaceActivity,
  WorkspaceCollaborator,
  WorkspaceSearchResult,
  WorkspaceSearchResultKind,
  WorkspaceTask,
  WorkspaceTaskGroup,
} from "./workspaceTypes";

export { createDocumentId, touchWorkspace } from "./workspaceCore";
export {
  createDefaultWorkspace,
  createWorkspaceDocument,
  deleteWorkspaceDocument,
  duplicateWorkspaceDocument,
  getActiveDocument,
  restoreWorkspaceDocument,
  switchActiveDocument,
  toggleDocumentPinned,
  updateActiveDocument,
  updateDocumentBlockStatus,
} from "./workspaceDocuments";
export {
  getSortedWorkspaceDocuments,
  getWorkspaceActivities,
  getWorkspaceCollaborators,
  getWorkspaceSearchResults,
  getWorkspaceTasks,
  groupWorkspaceTasksByDueDate,
} from "./workspaceQueries";
export { normalizeWorkspace } from "./workspaceNormalization";
export type {
  BlockContentUpdatedEvent,
  DocumentCreatedEvent,
  RemoteBlockContentPatch,
  RemoteDocumentStructurePatch,
  WorkspaceContentEvent,
} from "./workspaceEvents";
export {
  applyRemoteDocumentStructurePatch,
  applyRemoteBlockContentPatch,
  createBlockContentUpdatedEvent,
  createDocumentCreatedEvent,
  getWorkspaceContentEvents,
} from "./workspaceEvents";
