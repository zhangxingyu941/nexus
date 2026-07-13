import { MessageSquare, X } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { CommentFilter, BlockCommentView } from "./documentEditorTypes";
import { scrollToBlock } from "./documentEditorTypes";

interface CommentsPanelProps {
  commentCount: number;
  commentFilter: CommentFilter;
  isReadOnly: boolean;
  openCommentCount: number;
  visibleComments: BlockCommentView[];
  onChangeFilter: (filter: CommentFilter) => void;
  onClose: () => void;
  onResolveBlockComment: (blockId: string, commentId: string) => void;
}

export function CommentsPanel({
  commentCount,
  commentFilter,
  isReadOnly,
  openCommentCount,
  visibleComments,
  onChangeFilter,
  onClose,
  onResolveBlockComment,
}: CommentsPanelProps) {
  return (
    <Sheet defaultOpen onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full gap-0 p-0 sm:max-w-md" showCloseButton={false}>
        <aside aria-label="评论" className="flex min-h-0 flex-1 flex-col">
          <SheetHeader className="flex-row items-start justify-between border-b text-left">
            <div className="grid gap-1">
              <SheetTitle>评论</SheetTitle>
              <SheetDescription>{openCommentCount} 条待处理，共 {commentCount} 条</SheetDescription>
            </div>
            <Button aria-label="关闭评论" className="size-8" onClick={onClose} size="icon" type="button" variant="ghost">
              <X aria-hidden="true" className="size-4" />
            </Button>
          </SheetHeader>

          <div className="border-b p-3">
            <Tabs value={commentFilter} onValueChange={(value) => onChangeFilter(value as CommentFilter)}>
              <TabsList aria-label="评论筛选" className="grid w-full grid-cols-2">
                <TabsTrigger value="open">待处理 {openCommentCount}</TabsTrigger>
                <TabsTrigger value="all">全部 {commentCount}</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          <ScrollArea className="min-h-0 flex-1">
            <div className="grid gap-3 p-4">
              {visibleComments.length > 0 ? (
                visibleComments.map((comment) => (
                  <article className="grid grid-cols-[32px_minmax(0,1fr)] gap-3 rounded-md border p-3" key={comment.id}>
                    <Avatar className="size-8"><AvatarFallback>{comment.author.slice(0, 1)}</AvatarFallback></Avatar>
                    <div className="grid min-w-0 gap-2">
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <strong className="truncate text-sm font-medium">{comment.author}</strong>
                        <span className="shrink-0 text-muted-foreground">{comment.time}</span>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <Badge variant={comment.resolved ? "success" : "warning"}>{comment.resolved ? "已解决" : "待处理"}</Badge>
                        {!comment.resolved && !isReadOnly ? (
                          <Button className="h-7 px-2 text-[11px]" onClick={() => onResolveBlockComment(comment.blockId, comment.id)} size="sm" type="button" variant="ghost">标记解决</Button>
                        ) : null}
                      </div>
                      <Button aria-label="定位到块" className="h-auto min-w-0 justify-start whitespace-normal px-2 py-1.5 text-left" onClick={() => scrollToBlock(comment.blockId)} size="sm" type="button" variant="outline">
                        <span className="shrink-0">定位到块</span>
                        <span className="truncate text-muted-foreground">{comment.blockPreview}</span>
                      </Button>
                      <p className="m-0 text-sm leading-6">{comment.body}</p>
                    </div>
                  </article>
                ))
              ) : (
                <div className="grid justify-items-center gap-2 py-16 text-center">
                  <MessageSquare aria-hidden="true" className="size-5 text-muted-foreground" />
                  <strong className="text-sm">{commentFilter === "open" ? "没有待处理评论" : "还没有块评论"}</strong>
                  <span className="max-w-xs text-xs leading-5 text-muted-foreground">
                    {commentFilter === "open" ? "当前评论都已经处理完，可以切到全部查看历史讨论。" : "在任意内容块左侧点击评论图标即可发起讨论。"}
                  </span>
                </div>
              )}
            </div>
          </ScrollArea>
        </aside>
      </SheetContent>
    </Sheet>
  );
}
