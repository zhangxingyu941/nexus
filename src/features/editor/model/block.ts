export type BlockType = "paragraph" | "heading" | "todo";

export interface Block {
  id: string;
  type: BlockType;
  content: string;
  checked: boolean;
  parentId: string | null;
  children: string[];
  createdAt: number;
  updatedAt: number;
}

export interface EditorDocument {
  id: string;
  title: string;
  blocks: Block[];
  updatedAt: number;
}

export interface EditorWorkspace {
  documents: EditorDocument[];
  activeDocumentId: string;
  updatedAt: number;
}

export type MoveDirection = "up" | "down";
