import type { Block } from "../model/block";
import type { NexusBlockClipboardPayload } from "../model/blockClipboard";
import { jsonRequest, requestJson } from "./apiClient";

interface BlockClipboardPasteResponse {
  blocks: Block[];
}

export async function pasteBlockClipboard(
  workspaceId: string,
  documentId: string,
  payload: NexusBlockClipboardPayload,
): Promise<Block[]> {
  const response = await requestJson<BlockClipboardPasteResponse>(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/documents/${encodeURIComponent(documentId)}/block-paste`,
    jsonRequest("POST", { payload }),
  );
  return response.blocks;
}
