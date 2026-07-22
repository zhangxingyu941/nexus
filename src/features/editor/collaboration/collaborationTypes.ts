import type { Block } from "../model/block";
import type { RichTextDocument } from "../../../shared/richText";
import type * as Y from "yjs";

export type CollaborationConnectionState = "disabled" | "connecting" | "connected" | "offline";
export type CollaborationPresenceColor = "amber" | "blue" | "green" | "red";

export interface CollaborationLocalUser {
  color: CollaborationPresenceColor;
  name: string;
}

export interface CollaborationPresence extends CollaborationLocalUser {
  clientId: number;
  documentId: string;
  documentTitle: string;
  isLocal: boolean;
}

export interface BlockContentRecord {
  blockId: string;
  checked: boolean;
  content: string;
  documentId: string;
  richText?: RichTextDocument | null;
  updatedAt: number;
}

export type BlockStructureRecord = Block;

export interface DocumentStructureRecord {
  blocks: BlockStructureRecord[];
  documentId: string;
  pinned?: boolean;
  templateId?: string;
  title: string;
  updatedAt: number;
}

export type CollaborationDocument = Y.Doc;
