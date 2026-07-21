import type {
  AttachmentBlockData,
  BlockData,
  EditorDocument,
} from "../features/editor/model/block";
import type {
  SharedBlockData,
  SharedDocumentSnapshot,
} from "../shared/documentShare";

interface SharedDocumentSnapshotOptions {
  expiresAt: number;
  signedAttachmentUrls: ReadonlyMap<string, string>;
}

export function createSharedDocumentSnapshot(
  document: EditorDocument,
  options: SharedDocumentSnapshotOptions,
): SharedDocumentSnapshot {
  return {
    document: {
      blocks: document.blocks.map((block) => ({
        children: [...block.children],
        content: block.content,
        data: createSharedBlockData(
          block.type,
          block.data,
          options.signedAttachmentUrls,
        ),
        headingLevel: block.headingLevel,
        id: block.id,
        parentId: block.parentId,
        type: block.type,
      })),
      title: document.title,
    },
    expiresAt: options.expiresAt,
  };
}

function createSharedBlockData(
  blockType: string,
  data: BlockData | null,
  signedAttachmentUrls: ReadonlyMap<string, string>,
): SharedBlockData | null {
  if (!data) {
    return null;
  }

  if (isAttachmentData(data)) {
    if (blockType !== data.kind) {
      return null;
    }
    const signedUrl = signedAttachmentUrls.get(data.key);
    if (!signedUrl) {
      return null;
    }

    return {
      kind: data.kind,
      mimeType: data.mimeType,
      name: data.name,
      size: data.size,
      url: signedUrl,
    };
  }

  return structuredClone(data);
}

function isAttachmentData(data: BlockData): data is AttachmentBlockData {
  return data.kind === "image" || data.kind === "file";
}
