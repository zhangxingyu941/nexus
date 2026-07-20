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

export interface DocumentRepository {
  load(publicId: string): Promise<DocumentSnapshot>;
  loadPolicy(publicId: string): Promise<DocumentPolicySnapshot>;
  save(publicId: string, document: EditorDocument): Promise<DocumentSnapshot>;
  updatePolicy(publicId: string, policy: DocumentPolicy): Promise<DocumentPolicySnapshot>;
}

export function createDocumentRepository(): DocumentRepository {
  return {
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
