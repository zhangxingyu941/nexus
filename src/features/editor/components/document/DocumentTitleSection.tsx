import {
  CheckCircle2,
  Clock3,
  Cloud,
  CloudOff,
  Eye,
  LoaderCircle,
  MessageSquareText,
} from "lucide-react";
import type { RefObject } from "react";
import { Badge } from "@/components/ui/badge";
import type { EditorDocument } from "../../model/block";
import type { SaveStatus } from "./documentEditorTypes";
import { SAVE_STATUS_LABELS } from "./documentEditorTypes";

interface DocumentTitleSectionProps {
  document: EditorDocument;
  isReadOnly: boolean;
  openCommentCount: number;
  saveStatus: SaveStatus;
  titleInputRef: RefObject<HTMLTextAreaElement>;
  onChangeTitle: (title: string) => void;
}

export function DocumentTitleSection({
  document,
  isReadOnly,
  openCommentCount,
  saveStatus,
  titleInputRef,
  onChangeTitle,
}: DocumentTitleSectionProps) {
  const SaveIcon =
    saveStatus === "failed"
      ? CloudOff
      : saveStatus === "saving"
        ? LoaderCircle
        : saveStatus === "readonly"
          ? Eye
          : saveStatus === "remote"
            ? Cloud
            : CheckCircle2;
  const statusVariant =
    saveStatus === "failed"
      ? "destructive"
      : saveStatus === "saving" || saveStatus === "unsaved"
        ? "warning"
        : saveStatus === "remote"
          ? "success"
          : "outline";
  const updatedAt = new Intl.DateTimeFormat("zh-CN", {
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    month: "2-digit",
  }).format(document.updatedAt);

  return (
    <>
      <div className="mb-3 flex items-start justify-between gap-4 max-sm:flex-col max-sm:gap-2">
        <textarea
          aria-label="文档标题"
          className="document-title-input !min-h-12 !text-[2.75rem] max-sm:!text-[2rem]"
          onChange={(event) => onChangeTitle(event.target.value)}
          placeholder="未命名文档"
          readOnly={isReadOnly}
          ref={titleInputRef}
          rows={1}
          value={document.title}
        />
        <Badge
          aria-live="polite"
          className="mt-2 h-7 shrink-0"
          variant={statusVariant}
        >
          <SaveIcon
            aria-hidden="true"
            className={`size-3.5${saveStatus === "saving" ? " animate-spin" : ""}`}
          />
          {SAVE_STATUS_LABELS[saveStatus]}
        </Badge>
      </div>

      <div className="mb-8 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Badge className="gap-1.5 font-normal" variant="outline">
          <Clock3 aria-hidden="true" className="size-3.5" />
          最后编辑 {updatedAt}
        </Badge>
        <Badge
          className="gap-1.5 font-normal"
          variant={openCommentCount > 0 ? "warning" : "outline"}
        >
          <MessageSquareText aria-hidden="true" className="size-3.5" />
          {openCommentCount} 条评论待处理
        </Badge>
      </div>
    </>
  );
}
