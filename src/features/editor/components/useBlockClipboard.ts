import { useCallback } from "react";
import type { RichTextDocument } from "@/shared/richText";
import {
  clipboardPayloadToPlainText,
  clipboardPayloadToSafeHtml,
  NEXUS_BLOCK_CLIPBOARD_MIME,
  parseBlockClipboardPayload,
  type NexusBlockClipboardPayload,
} from "../model/blockClipboard";
import { parseRichTextClipboard } from "./richTextPaste";

interface ClipboardDataLike {
  getData(type: string): string;
}

export type BlockClipboardReadResult =
  | { kind: "nexus"; payload: NexusBlockClipboardPayload }
  | { fallback: "html"; kind: "rich-text"; richText: RichTextDocument }
  | { fallback: "plain-text"; kind: "plain-text"; text: string };

export interface BlockClipboardWriteResult {
  message?: string;
  ok: boolean;
}

interface ClipboardWriter {
  write(items: ClipboardItem[]): Promise<void>;
}

export function readBlockClipboard(clipboardData: ClipboardDataLike): BlockClipboardReadResult {
  const structured = clipboardData.getData(NEXUS_BLOCK_CLIPBOARD_MIME);
  if (structured) {
    try {
      const { payload } = parseBlockClipboardPayload(JSON.parse(structured));
      if (payload) {
        return { kind: "nexus", payload };
      }
    } catch {
      // A malformed custom MIME payload must fall through to safe external formats.
    }
  }

  if (clipboardData.getData("text/html")) {
    return {
      fallback: "html",
      kind: "rich-text",
      richText: parseRichTextClipboard(clipboardData),
    };
  }

  return {
    fallback: "plain-text",
    kind: "plain-text",
    text: clipboardData.getData("text/plain").replace(/\r\n?/g, "\n"),
  };
}

export async function writeBlockClipboard(
  payload: NexusBlockClipboardPayload,
  clipboard: ClipboardWriter | undefined = globalThis.navigator?.clipboard,
): Promise<BlockClipboardWriteResult> {
  if (!clipboard?.write || typeof ClipboardItem === "undefined") {
    return { message: "系统剪贴板不可用", ok: false };
  }

  try {
    await clipboard.write([
      new ClipboardItem({
        [NEXUS_BLOCK_CLIPBOARD_MIME]: new Blob([JSON.stringify(payload)], { type: NEXUS_BLOCK_CLIPBOARD_MIME }),
        "text/html": new Blob([clipboardPayloadToSafeHtml(payload)], { type: "text/html" }),
        "text/plain": new Blob([clipboardPayloadToPlainText(payload)], { type: "text/plain" }),
      }),
    ]);
    return { ok: true };
  } catch {
    return { message: "系统剪贴板不可用", ok: false };
  }
}

export function useBlockClipboard() {
  const copy = useCallback((payload: NexusBlockClipboardPayload) => writeBlockClipboard(payload), []);
  const read = useCallback((clipboardData: ClipboardDataLike) => readBlockClipboard(clipboardData), []);

  return { copy, read };
}
