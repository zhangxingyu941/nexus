import type { EditorDocument } from "../model/block";
import type { DocumentAccess, DocumentPolicy } from "../../../shared/documentAccess";
import { jsonRequest, requestJson } from "./apiClient";

export interface DocumentSnapshot {
  access: DocumentAccess;
  document: EditorDocument;
}

export interface DocumentPolicySnapshot {
  access: DocumentAccess;
  policy: DocumentPolicy;
}

export interface DocumentDeleteSnapshot {
  activeDocumentPublicId: string;
}

export interface DocumentRepository {
  create(workspaceId: string, document: EditorDocument, position: number): Promise<DocumentSnapshot>;
  delete(workspaceId: string, publicId: string): Promise<DocumentDeleteSnapshot>;
  load(publicId: string): Promise<DocumentSnapshot>;
  loadPolicy(publicId: string): Promise<DocumentPolicySnapshot>;
  save(publicId: string, document: EditorDocument): Promise<DocumentSnapshot>;
  updatePolicy(publicId: string, policy: DocumentPolicy): Promise<DocumentPolicySnapshot>;
}

export function createDocumentRepository(): DocumentRepository {
  return {
    create: (workspaceId, document, position) => requestJson(
      workspaceDocumentsUrl(workspaceId),
      jsonRequest("POST", { document, position }),
    ),
    delete: (workspaceId, publicId) => requestJson(
      `${workspaceDocumentsUrl(workspaceId)}/${encodeURIComponent(publicId)}`,
      jsonRequest("DELETE"),
    ),
    load: (publicId) => requestJson(documentUrl(publicId), jsonRequest("GET")),
    loadPolicy: (publicId) => requestJson(permissionUrl(publicId), jsonRequest("GET")),
    save: (publicId, document) => requestJson(
      documentUrl(publicId),
      jsonRequest("PUT", { document }),
    ),
    updatePolicy: (publicId, policy) => requestJson(
      permissionUrl(publicId),
      jsonRequest("PATCH", policy),
    ),
  };
}

function documentUrl(publicId: string) {
  return `/api/documents/${encodeURIComponent(publicId)}`;
}

function permissionUrl(publicId: string) {
  return `${documentUrl(publicId)}/permissions`;
}

function workspaceDocumentsUrl(workspaceId: string) {
  return `/api/workspaces/${encodeURIComponent(workspaceId)}/documents`;
}
