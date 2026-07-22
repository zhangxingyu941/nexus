import type { Block, BlockComment, EditorDocument, EditorWorkspace } from "./block";
import type { DocumentTemplateId } from "./documentOperations";

export type CreateWorkspaceDocumentInput =
  | string
  | {
      title?: string;
      templateId?: DocumentTemplateId;
    };

export interface WorkspaceTask {
  id: string;
  blockId: string;
  documentId: string;
  documentTitle: string;
  content: string;
  assignee: string;
  dueDate: string;
  status: Block["status"];
  updatedAt: number;
}

export interface WorkspaceActivity {
  id: string;
  documentId: string;
  documentTitle: string;
  title: string;
  action: string;
  actor: string;
  time: string;
  updatedAt: number;
  blockId?: string;
}

export type WorkspaceSearchResultKind = "document" | "heading" | "task" | "block" | "comment";

export interface WorkspaceSearchResult {
  id: string;
  kind: WorkspaceSearchResultKind;
  documentId: string;
  documentTitle: string;
  title: string;
  subtitle: string;
  updatedAt: number;
  blockId?: string;
}

export interface WorkspaceTaskGroup {
  id: "today" | "tomorrow" | "week" | "unset";
  label: string;
  tasks: WorkspaceTask[];
}

export interface WorkspaceCollaborator {
  name: string;
  role: string;
  status: "online" | "editing" | "away" | "unknown";
  activeDocumentTitle: string;
  activeTaskCount: number;
  openCommentCount: number;
  color: "green" | "blue" | "red" | "amber";
}

export type StoredBlock = Omit<Partial<Block>, "richText" | "type"> & {
  richText?: unknown;
  type?: string;
};

export type StoredBlockComment = Partial<BlockComment>;

export type StoredDocument = Omit<Partial<EditorDocument>, "blocks"> & {
  blocks?: StoredBlock[];
};

export type StoredWorkspace = Omit<Partial<EditorWorkspace>, "documents"> & {
  documents?: StoredDocument[];
};
