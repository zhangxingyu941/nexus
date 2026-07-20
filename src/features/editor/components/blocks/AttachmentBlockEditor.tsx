import { FileText, ImageIcon, Trash2, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { AttachmentBlockData } from "../../model/block";
import { uploadAttachment } from "../../persistence/attachmentRepository";

interface AttachmentBlockEditorProps {
  content: string;
  data: AttachmentBlockData | null;
  documentId: string;
  isReadOnly: boolean;
  kind: "image" | "file";
  onChangeContent: (content: string) => void;
  onChangeData: (data: AttachmentBlockData | null) => void;
  workspaceId: string;
}

function formatFileSize(size: number) {
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${Math.round(size / 1024)} KB`;
  }

  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

export function AttachmentBlockEditor({
  content,
  data,
  documentId,
  isReadOnly,
  kind,
  onChangeContent,
  onChangeData,
  workspaceId,
}: AttachmentBlockEditorProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [status, setStatus] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const label = kind === "image" ? "图片" : "文件";

  const handleFileChange = async (file: File | undefined) => {
    if (!file) {
      return;
    }

    setIsUploading(true);
    setStatus("");

    try {
      onChangeData(await uploadAttachment(workspaceId, documentId, file, kind));
      setStatus(`${label}已上传`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : `${label}上传失败`);
    } finally {
      setIsUploading(false);
      if (inputRef.current) {
        inputRef.current.value = "";
      }
    }
  };

  const uploadInput = !isReadOnly ? (
    <input
      accept={kind === "image" ? "image/*" : undefined}
      aria-label={`上传${label}`}
      className="sr-only"
      onChange={(event) => void handleFileChange(event.target.files?.[0])}
      ref={inputRef}
      type="file"
    />
  ) : null;

  if (!data || data.kind !== kind) {
    return (
      <div className="grid min-h-32 place-items-center gap-3 rounded-md border border-dashed bg-muted/20 p-6 text-center">
        {kind === "image" ? <ImageIcon aria-hidden="true" className="size-6 text-muted-foreground" /> : <FileText aria-hidden="true" className="size-6 text-muted-foreground" />}
        <div className="grid gap-1">
          <strong className="text-sm font-medium">{isReadOnly ? `暂无${label}` : `添加${label}`}</strong>
          {!isReadOnly ? <span className="text-xs text-muted-foreground">最大 20MB</span> : null}
        </div>
        {uploadInput}
        {!isReadOnly ? (
          <Button disabled={isUploading} onClick={() => inputRef.current?.click()} size="sm" type="button" variant="outline">
            <Upload aria-hidden="true" className="size-4" />
            {isUploading ? "上传中" : `选择${label}`}
          </Button>
        ) : null}
        {status ? <span aria-live="polite" className="text-xs text-muted-foreground" role="status">{status}</span> : null}
      </div>
    );
  }

  return (
    <div className="grid gap-2 rounded-md border bg-background p-2">
      {kind === "image" ? (
        <img
          alt={content.trim() || data.name}
          className="max-h-[420px] w-full rounded-md bg-muted/30 object-contain"
          src={data.url}
        />
      ) : (
        <a
          aria-label={`打开文件 ${data.name}`}
          className="flex min-w-0 items-center gap-3 rounded-md px-2 py-3 hover:bg-muted"
          href={data.url}
          rel="noreferrer"
          target="_blank"
        >
          <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-md border bg-muted">
            <FileText className="size-4" />
          </span>
          <span className="grid min-w-0 flex-1 gap-0.5">
            <strong className="truncate text-sm font-medium">{data.name}</strong>
            <small className="text-xs text-muted-foreground">{data.mimeType} · {formatFileSize(data.size)}</small>
          </span>
        </a>
      )}

      {isReadOnly ? (
        content ? <p className="m-0 px-2 pb-1 text-sm text-muted-foreground">{content}</p> : null
      ) : (
        <div className="flex items-center gap-2">
          <Input
            aria-label={`${label}说明`}
            className="h-8 min-w-0 flex-1 border-0 shadow-none focus-visible:ring-0"
            onChange={(event) => onChangeContent(event.target.value)}
            placeholder={`${label}说明`}
            value={content}
          />
          {uploadInput}
          <Button aria-label={`替换${label} ${data.name}`} className="size-8" disabled={isUploading} onClick={() => inputRef.current?.click()} size="icon" type="button" variant="ghost">
            <Upload aria-hidden="true" className="size-4" />
          </Button>
          <Button aria-label={`移除${label} ${data.name}`} className="size-8 text-muted-foreground hover:text-destructive" onClick={() => onChangeData(null)} size="icon" type="button" variant="ghost">
            <Trash2 aria-hidden="true" className="size-4" />
          </Button>
        </div>
      )}
      {status ? <span aria-live="polite" className="px-2 text-xs text-muted-foreground" role="status">{status}</span> : null}
    </div>
  );
}
