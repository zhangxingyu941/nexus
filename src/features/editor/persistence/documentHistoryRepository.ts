import type { EditorDocument } from "../model/block";

export interface DocumentVersionSummary {
  id: string;
  documentId: string;
  title: string;
  createdAt: number;
  createdBy: string;
}

async function parseJsonResponse<T>(response: Response, fallbackMessage: string): Promise<T> {
  const payload = await response.json() as T & { error?: string };

  if (!response.ok) {
    throw new Error(payload.error || fallbackMessage);
  }

  return payload;
}

export async function loadDocumentVersions(documentId: string): Promise<DocumentVersionSummary[]> {
  const response = await fetch(`/api/history/${encodeURIComponent(documentId)}`, {
    headers: { Accept: "application/json" },
    method: "GET",
  });
  const payload = await parseJsonResponse<{ versions: DocumentVersionSummary[] }>(
    response,
    "历史版本读取失败",
  );

  return payload.versions;
}

export async function restoreDocumentVersion(documentId: string, versionId: string) {
  const response = await fetch(`/api/history/${encodeURIComponent(documentId)}`, {
    body: JSON.stringify({ versionId }),
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    method: "POST",
  });
  const payload = await parseJsonResponse<{ document: EditorDocument; restored: true }>(
    response,
    "历史版本恢复失败",
  );

  return payload.document;
}
