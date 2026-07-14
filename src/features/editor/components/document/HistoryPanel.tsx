import { RotateCcw, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { WorkspaceActivity } from "../../model/workspaceOperations";
import type { EditorDocument } from "../../model/block";
import {
  loadDocumentVersions,
  restoreDocumentVersion,
} from "../../persistence/documentHistoryRepository";
import type { DocumentVersionSummary } from "../../persistence/documentHistoryRepository";

interface HistoryPanelProps {
  activities: WorkspaceActivity[];
  documentId: string;
  isReadOnly: boolean;
  onClose: () => void;
  onRestoreDocument: (document: EditorDocument) => void;
}

function formatVersionTime(timestamp: number) {
  return new Intl.DateTimeFormat("zh-CN", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
  }).format(new Date(timestamp));
}

export function HistoryPanel({
  activities,
  documentId,
  isReadOnly,
  onClose,
  onRestoreDocument,
}: HistoryPanelProps) {
  const [versions, setVersions] = useState<DocumentVersionSummary[] | null>(null);
  const [restoreStatus, setRestoreStatus] = useState("");
  const [restoringVersionId, setRestoringVersionId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    loadDocumentVersions(documentId)
      .then((nextVersions) => {
        if (!cancelled) {
          setVersions(nextVersions);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setVersions([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [documentId]);

  const handleRestore = async (version: DocumentVersionSummary) => {
    setRestoringVersionId(version.id);
    setRestoreStatus("");

    try {
      const restoredDocument = await restoreDocumentVersion(documentId, version.id);
      onRestoreDocument(restoredDocument);
      setRestoreStatus("版本已恢复");
      setVersions(await loadDocumentVersions(documentId));
    } catch (error) {
      setRestoreStatus(error instanceof Error ? error.message : "版本恢复失败");
    } finally {
      setRestoringVersionId(null);
    }
  };

  return (
    <Sheet defaultOpen onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full gap-0 p-0 sm:max-w-md" showCloseButton={false}>
        <aside aria-label="历史记录" className="flex min-h-0 flex-1 flex-col">
          <SheetHeader className="flex-row items-start justify-between border-b text-left">
            <div className="grid gap-1">
              <SheetTitle>历史记录</SheetTitle>
              <SheetDescription>
                {versions && versions.length > 0 ? `${versions.length} 个可恢复版本` : `${activities.length} 条版本动态`}
              </SheetDescription>
            </div>
            <Button aria-label="关闭历史记录" className="size-8" onClick={onClose} size="icon" type="button" variant="ghost">
              <X aria-hidden="true" className="size-4" />
            </Button>
          </SheetHeader>

          <ScrollArea className="min-h-0 flex-1">
            {versions === null ? (
              <p className="p-6 text-sm text-muted-foreground">正在读取历史版本</p>
            ) : versions.length > 0 ? (
              <div className="grid gap-2 p-4">
                {versions.map((version, index) => (
                  <article className="grid gap-3 rounded-md border p-3" key={version.id}>
                    <div className="flex min-w-0 items-start justify-between gap-3">
                      <div className="grid min-w-0 gap-1">
                        <strong className="truncate text-sm font-medium">{version.title}</strong>
                        <span className="text-xs text-muted-foreground">
                          {version.createdBy} · {formatVersionTime(version.createdAt)}
                        </span>
                      </div>
                      {index === 0 ? (
                        <span className="shrink-0 rounded-md bg-muted px-2 py-1 text-[11px] text-muted-foreground">当前</span>
                      ) : !isReadOnly ? (
                        <Button
                          aria-label={`恢复版本 ${version.title}`}
                          disabled={restoringVersionId !== null}
                          onClick={() => void handleRestore(version)}
                          size="sm"
                          type="button"
                          variant="outline"
                        >
                          <RotateCcw aria-hidden="true" className="size-3.5" />
                          {restoringVersionId === version.id ? "恢复中" : "恢复"}
                        </Button>
                      ) : null}
                    </div>
                  </article>
                ))}
                {restoreStatus ? <p aria-live="polite" className="m-0 text-xs text-muted-foreground" role="status">{restoreStatus}</p> : null}
              </div>
            ) : activities.length > 0 ? (
              <div className="grid gap-0 p-4">
                {activities.map((activity, index) => (
                  <article className="relative grid grid-cols-[18px_minmax(0,1fr)] gap-3 pb-5" key={activity.id}>
                    <span aria-hidden="true" className="mt-1.5 size-2 rounded-full bg-foreground" />
                    {index < activities.length - 1 ? <span aria-hidden="true" className="absolute bottom-0 left-[3px] top-3 w-px bg-border" /> : null}
                    <div className="grid gap-1">
                      <div className="flex items-center justify-between gap-2">
                        <strong className="truncate text-sm font-medium">{activity.title}</strong>
                        <span className="shrink-0 text-xs text-muted-foreground">{activity.time}</span>
                      </div>
                      <p className="m-0 text-xs leading-5 text-muted-foreground">{activity.actor}{activity.action}</p>
                    </div>
                  </article>
                ))}
              </div>
            ) : <p className="p-6 text-sm text-muted-foreground">暂无历史记录</p>}
          </ScrollArea>
        </aside>
      </SheetContent>
    </Sheet>
  );
}
