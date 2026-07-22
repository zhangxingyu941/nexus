import type { Block, BlockType, EditorDocument } from "../features/editor/model/block";
import { isRichTextBlockType } from "../features/editor/model/documentOperations";
import {
  RichTextValidationError,
  createRichTextFromPlainText,
  normalizeRichText,
  projectRichTextContent,
  type RichTextDocument,
} from "../shared/richText";

export function normalizeBlockForStorage(block: Block): Block {
  if (!isRichTextBlockType(block.type)) {
    if (block.richText !== null && block.richText !== undefined) {
      throw new RichTextValidationError("unsupported-block");
    }
    return { ...block, richText: null };
  }

  const richText = normalizeRichText(
    block.richText ?? createRichTextFromPlainText(block.content),
  );
  return {
    ...block,
    content: projectRichTextContent(richText),
    richText,
  };
}

export function normalizeDocumentForStorage(document: EditorDocument): EditorDocument {
  return {
    ...document,
    blocks: document.blocks.map(normalizeBlockForStorage),
  };
}

export function readStoredRichText(
  type: BlockType,
  value: unknown,
  content: string,
): RichTextDocument | null {
  if (!isRichTextBlockType(type)) {
    return null;
  }

  try {
    return value === null || value === undefined
      ? createRichTextFromPlainText(content)
      : normalizeRichText(value);
  } catch {
    return createRichTextFromPlainText(content);
  }
}

export function readDocumentRichText(document: EditorDocument): EditorDocument {
  return {
    ...document,
    blocks: document.blocks.map((block) => {
      const richText = readStoredRichText(block.type, block.richText, block.content);
      return {
        ...block,
        content: richText ? projectRichTextContent(richText) : block.content,
        richText,
      };
    }),
  };
}
