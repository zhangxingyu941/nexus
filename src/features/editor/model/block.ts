export type BlockType =
  | "paragraph"
  | "heading"
  | "todo"
  | "quote"
  | "code"
  | "image"
  | "file"
  | "table"
  | "kanban"
  | "divider"
  | "bulletedList"
  | "numberedList"
  | "toggle"
  | "formula"
  | "linkCard";

export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

export type BlockStatus = "unset" | "todo" | "in-progress" | "review" | "done";

export interface BlockComment {
  id: string;
  author: string;
  body: string;
  time: string;
  createdAt: number;
  resolved: boolean;
  resolvedAt?: number;
}

export interface AttachmentBlockData {
  kind: "image" | "file";
  key: string;
  mimeType: string;
  name: string;
  size: number;
  url: string;
}

export interface TableBlockData {
  kind: "table";
  columns: Array<{ id: string; name: string }>;
  rows: Array<{ id: string; cells: Record<string, string> }>;
}

export interface KanbanBlockData {
  kind: "kanban";
  columns: Array<{
    id: string;
    title: string;
    cards: Array<{ id: string; title: string }>;
  }>;
}

export interface ToggleBlockData {
  kind: "toggle";
  collapsed: boolean;
}

export interface FormulaBlockData {
  kind: "formula";
  latex: string;
}

export interface LinkCardBlockData {
  kind: "linkCard";
  url: string;
  title: string;
  description: string;
}

export type BlockData =
  | AttachmentBlockData
  | TableBlockData
  | KanbanBlockData
  | ToggleBlockData
  | FormulaBlockData
  | LinkCardBlockData;

export interface Block {
  id: string;
  type: BlockType;
  headingLevel: HeadingLevel;
  content: string;
  data: BlockData | null;
  checked: boolean;
  comments: BlockComment[];
  assignee: string;
  dueDate: string;
  status: BlockStatus;
  parentId: string | null;
  children: string[];
  createdAt: number;
  updatedAt: number;
}

export interface EditorDocument {
  id: string;
  title: string;
  templateId?: string;
  pinned?: boolean;
  blocks: Block[];
  updatedAt: number;
}

export interface EditorWorkspace {
  documents: EditorDocument[];
  activeDocumentId: string;
  updatedAt: number;
}

export type MoveDirection = "up" | "down";
