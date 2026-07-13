import { Copy, FileText, MoreHorizontal, Pencil, Pin, PinOff, Search, Star, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { EditorDocument } from "../../model/block";
import { getDocumentTitle, renderHighlightedTitle } from "./sidebarUtils";

interface DocumentTreeProps {
  activeDocumentId: string;
  canDeleteDocument: boolean;
  documentFilter: string;
  documents: EditorDocument[];
  isReadOnly: boolean;
  openActionDocumentId: string | null;
  totalDocumentCount: number;
  onClearFilter: () => void;
  onDeleteDocument: (documentId: string) => void;
  onDuplicateDocument: (documentId: string) => void;
  onRenameDocument: (documentId: string) => void;
  onSelectDocument: (documentId: string) => void;
  onSetDocumentFilter: (filter: string) => void;
  onSetOpenActionDocumentId: (documentId: string | null) => void;
  onToggleDocumentPinned: (documentId: string) => void;
}

export function DocumentTree({
  activeDocumentId,
  canDeleteDocument,
  documentFilter,
  documents,
  isReadOnly,
  openActionDocumentId,
  totalDocumentCount,
  onClearFilter,
  onDeleteDocument,
  onDuplicateDocument,
  onRenameDocument,
  onSelectDocument,
  onSetDocumentFilter,
  onSetOpenActionDocumentId,
  onToggleDocumentPinned,
}: DocumentTreeProps) {
  const handleAction = (action: () => void) => {
    onSetOpenActionDocumentId(null);
    action();
  };

  return (
    <>
      <div className="flex items-center justify-between gap-2 px-2 pb-2 pt-1">
        <p className="text-[11px] font-semibold text-muted-foreground">项目空间</p>
        <span className="text-[11px] tabular-nums text-muted-foreground">
          {documents.length} / {totalDocumentCount}
        </span>
      </div>
      <label className="relative mb-2 block">
        <Search aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 z-10 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          aria-label="筛选文档"
          className="h-8 border-transparent bg-background/80 pl-8 pr-8 text-xs shadow-none hover:border-border focus-visible:bg-background"
          onChange={(event) => onSetDocumentFilter(event.target.value)}
          placeholder="筛选文档"
          value={documentFilter}
        />
        {documentFilter ? (
          <Button aria-label="清空筛选" className="absolute right-1 top-1/2 size-6 -translate-y-1/2" onClick={onClearFilter} size="icon" type="button" variant="ghost">
            <X aria-hidden="true" className="size-3.5" />
          </Button>
        ) : null}
      </label>
      <ul className="grid list-none gap-0.5 p-0">
        {documents.map((document) => {
          const isActive = document.id === activeDocumentId;
          const title = getDocumentTitle(document);

          return (
            <li className="group" key={document.id}>
              <div className={cn("relative grid items-center gap-1", isReadOnly ? "grid-cols-1" : "grid-cols-[minmax(0,1fr)_28px]")}>
                <Button
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "relative h-9 min-w-0 justify-between px-2 text-sm font-normal text-foreground",
                    isActive && "bg-accent font-semibold text-accent-foreground hover:bg-accent",
                  )}
                  data-testid={`document-nav-${document.id}`}
                  onClick={() => onSelectDocument(document.id)}
                  type="button"
                  variant="ghost"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    {document.pinned ? (
                      <Star aria-hidden="true" className="size-3.5 shrink-0 fill-amber-400 text-amber-500" />
                    ) : (
                      <FileText aria-hidden="true" className={cn("size-3.5 shrink-0 text-muted-foreground", isActive && "text-primary")} />
                    )}
                    <span className="truncate">{renderHighlightedTitle(title, documentFilter)}</span>
                  </span>
                  <span className="text-[11px] tabular-nums text-muted-foreground">{document.blocks.length}</span>
                </Button>
                {!isReadOnly ? (
                  <DropdownMenu
                    open={openActionDocumentId === document.id}
                    onOpenChange={(open) => onSetOpenActionDocumentId(open ? document.id : null)}
                  >
                    <DropdownMenuTrigger asChild>
                      <Button
                        aria-label={`打开文档操作 ${title}`}
                        className="size-7 text-muted-foreground opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 data-[state=open]:opacity-100"
                        size="icon"
                        type="button"
                        variant="ghost"
                      >
                        <MoreHorizontal aria-hidden="true" className="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" aria-label={`${title} 文档操作`} className="w-44">
                      <DropdownMenuItem onSelect={() => handleAction(() => onRenameDocument(document.id))}>
                        <Pencil aria-hidden="true" size={15} />
                        <span>重命名</span>
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        aria-label={document.pinned ? "取消置顶" : "置顶文档"}
                        onSelect={() => handleAction(() => onToggleDocumentPinned(document.id))}
                      >
                        {document.pinned ? <PinOff aria-hidden="true" size={15} /> : <Pin aria-hidden="true" size={15} />}
                        <span>{document.pinned ? "取消置顶" : "置顶文档"}</span>
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        aria-label="复制文档"
                        onSelect={() => handleAction(() => onDuplicateDocument(document.id))}
                      >
                        <Copy aria-hidden="true" size={15} />
                        <span>复制文档</span>
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        aria-label="删除文档"
                        disabled={!canDeleteDocument}
                        onSelect={() => handleAction(() => onDeleteDocument(document.id))}
                        variant="destructive"
                      >
                        <Trash2 aria-hidden="true" size={15} />
                        <span>删除文档</span>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
      {documents.length === 0 ? (
        <div className="mx-1 grid justify-items-center gap-1 rounded-md border border-dashed bg-background/60 px-4 py-6 text-center">
          <FileText aria-hidden="true" className="mb-1 size-5 text-muted-foreground" />
          <strong className="text-xs font-semibold text-foreground">没有找到匹配文档</strong>
          <span className="text-xs leading-5 text-muted-foreground">
            {isReadOnly ? "换个关键词后重试。" : "换个关键词，或者从快速搜索里直接新建。"}
          </span>
        </div>
      ) : null}
    </>
  );
}
