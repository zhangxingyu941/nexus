import { useMemo, useState } from "react";
import { FileUp } from "lucide-react";
import type { EditorDocument } from "../model/block";
import {
  MarkdownTransferClientError,
  createMarkdownTransferRepository,
  type MarkdownTransferPreview,
  type MarkdownTransferTarget,
} from "../persistence/markdownTransferRepository";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface MarkdownTransferDialogProps {
  onImported: (document: EditorDocument) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  target: MarkdownTransferTarget;
  workspaceId: string;
}

export function MarkdownTransferDialog({
  onImported,
  onOpenChange,
  open,
  target,
  workspaceId,
}: MarkdownTransferDialogProps) {
  const repository = useMemo(() => createMarkdownTransferRepository(target), [target]);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<MarkdownTransferPreview | null>(null);
  const [error, setError] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const hasErrors = preview?.diagnostics.some((diagnostic) => diagnostic.severity === "error") ?? false;

  const selectFile = async (selected: File | null) => {
    setFile(selected);
    setPreview(null);
    setError("");
    if (!selected) return;

    try {
      const nextPreview = await repository.preview(selected);
      setPreview(nextPreview);
      if (nextPreview.diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
        setError(nextPreview.diagnostics.find((diagnostic) => diagnostic.severity === "error")?.message || "Markdown is invalid");
      }
    } catch (previewError) {
      setError(messageFor(previewError));
    }
  };

  const importDocument = async () => {
    if (!file || hasErrors || isBusy) return;
    setIsBusy(true);
    setError("");
    try {
      const result = await repository.importDocument(workspaceId, file);
      onImported(result.document);
      onOpenChange(false);
    } catch (importError) {
      setError(messageFor(importError));
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Import Markdown</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4">
          <label className="grid gap-2 text-sm font-medium" htmlFor="markdown-transfer-file">
            Select Markdown file
            <input
              accept={target === "local" ? ".md,text/markdown" : ".md,.zip,text/markdown,application/zip"}
              className="block w-full text-sm"
              id="markdown-transfer-file"
              onChange={(event) => void selectFile(event.currentTarget.files?.[0] ?? null)}
              type="file"
            />
          </label>
          {preview?.document ? (
            <div className="grid gap-1 border-y py-3 text-sm" role="status">
              <strong>{preview.document.title}</strong>
              <span className="text-muted-foreground">{preview.document.blocks.length} blocks</span>
            </div>
          ) : null}
          {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button
            disabled={!file || !preview?.document || hasErrors || Boolean(error) || isBusy}
            onClick={() => void importDocument()}
            type="button"
          >
            <FileUp aria-hidden="true" className="size-4" />
            Import as new document
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function messageFor(error: unknown) {
  if (error instanceof MarkdownTransferClientError) return error.message;
  return error instanceof Error && error.message ? error.message : "Markdown transfer failed";
}
