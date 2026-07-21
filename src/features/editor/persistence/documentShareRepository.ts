import type {
  CreatedDocumentShare,
  DocumentShareSummary,
} from "../../../shared/documentShare";
import { jsonRequest, requestJson } from "./apiClient";

interface DocumentShareResponse<T> {
  shareLink: T;
}

export interface DocumentShareRepository {
  create(publicId: string, expiresAt?: number): Promise<CreatedDocumentShare>;
  load(publicId: string): Promise<DocumentShareSummary | null>;
  revoke(publicId: string): Promise<void>;
}

export function createDocumentShareRepository(): DocumentShareRepository {
  return {
    create: async (publicId, expiresAt) => {
      const response = await requestJson<DocumentShareResponse<CreatedDocumentShare>>(
        shareLinksUrl(publicId),
        jsonRequest("POST", expiresAt === undefined ? {} : { expiresAt }),
      );
      return response.shareLink;
    },
    load: async (publicId) => {
      const response = await requestJson<DocumentShareResponse<DocumentShareSummary | null>>(
        shareLinksUrl(publicId),
        jsonRequest("GET"),
      );
      return response.shareLink;
    },
    revoke: (publicId) => requestJson<void>(
      shareLinksUrl(publicId),
      jsonRequest("DELETE"),
    ),
  };
}

function shareLinksUrl(publicId: string) {
  return `/api/documents/${encodeURIComponent(publicId)}/share-links`;
}
