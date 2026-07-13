import { FileText, Plus, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { WorkspaceSearchResult } from "../../model/workspaceOperations";
import { renderHighlightedTitle } from "./sidebarUtils";

interface QuickSearchDialogProps {
  isReadOnly: boolean;
  query: string;
  results: WorkspaceSearchResult[];
  searchCreateTitle: string;
  onChangeQuery: (query: string) => void;
  onClose: () => void;
  onCreateFromSearch: () => void;
  onSelectResult: (result: WorkspaceSearchResult) => void;
}

function getResultKindLabel(kind: WorkspaceSearchResult["kind"]) {
  if (kind === "document") {
    return "文档";
  }

  if (kind === "comment") {
    return "评论";
  }

  if (kind === "task") {
    return "任务";
  }

  if (kind === "heading") {
    return "标题";
  }

  return "正文";
}

export function QuickSearchDialog({
  isReadOnly,
  query,
  results,
  searchCreateTitle,
  onChangeQuery,
  onClose,
  onCreateFromSearch,
  onSelectResult,
}: QuickSearchDialogProps) {
  return (
    <Dialog defaultOpen modal={false} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="gap-0 overflow-hidden p-0 sm:max-w-xl"
        onCloseAutoFocus={(event) => event.preventDefault()}
        showOverlay={false}
      >
        <DialogHeader className="border-b px-5 py-4 pr-12">
          <DialogTitle>快速搜索</DialogTitle>
          <DialogDescription>搜索文档、正文、任务和评论。</DialogDescription>
        </DialogHeader>
        <div className="relative border-b p-3">
          <Search aria-hidden="true" className="pointer-events-none absolute left-6 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="搜索工作区内容"
            autoFocus
            className="h-10 pl-9 shadow-none"
            onChange={(event) => onChangeQuery(event.target.value)}
            placeholder="输入关键词"
            value={query}
          />
        </div>

        <ScrollArea className="max-h-[min(430px,60vh)]">
          <div className="grid gap-1 p-2">
            {results.length > 0 ? (
              <>
                <p className="px-2 py-1 text-xs font-medium text-muted-foreground">
                  {searchCreateTitle ? "搜索结果" : "最近文档"}
                </p>
                {results.map((result) => (
                  <Button
                    aria-label={`打开搜索结果 ${result.title}${result.title === result.documentTitle ? "" : ` ${result.documentTitle}`}`}
                    className="h-auto w-full justify-start whitespace-normal px-3 py-2.5 text-left"
                    key={result.id}
                    onClick={() => onSelectResult(result)}
                    type="button"
                    variant="ghost"
                  >
                    <FileText aria-hidden="true" className="size-4 self-start text-muted-foreground" />
                    <span className="grid min-w-0 flex-1 gap-0.5">
                      <strong className="truncate text-sm font-medium">{renderHighlightedTitle(result.title, query)}</strong>
                      <small className="truncate text-xs font-normal text-muted-foreground">{result.subtitle}</small>
                    </span>
                    <Badge className="font-normal" variant="outline">{getResultKindLabel(result.kind)}</Badge>
                  </Button>
                ))}
              </>
            ) : searchCreateTitle && !isReadOnly ? (
              <Button
                aria-label={`新建“${searchCreateTitle}”`}
                className="h-auto w-full justify-start whitespace-normal px-3 py-3 text-left"
                onClick={onCreateFromSearch}
                type="button"
                variant="ghost"
              >
                <Plus aria-hidden="true" className="size-4 text-muted-foreground" />
                <span className="grid gap-0.5">
                  <strong className="text-sm font-medium">新建“{searchCreateTitle}”</strong>
                  <small className="text-xs font-normal text-muted-foreground">创建新文档并立即打开</small>
                </span>
              </Button>
            ) : (
              <p className="px-3 py-8 text-center text-sm text-muted-foreground">没有匹配的文档</p>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
