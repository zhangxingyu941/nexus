import type { FormEvent } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { Block } from "../../model/block";

interface BlockCommentsPopoverProps {
  block: Block;
  commentDraft: string;
  isReadOnly: boolean;
  onChangeCommentDraft: (value: string) => void;
  onResolveComment: (blockId: string, commentId: string) => void;
  onSubmitComment: () => void;
}

export function BlockCommentsPopover({
  block,
  commentDraft,
  isReadOnly,
  onChangeCommentDraft,
  onResolveComment,
  onSubmitComment,
}: BlockCommentsPopoverProps) {
  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    onSubmitComment();
  };

  return (
    <div aria-label="块评论" className="grid gap-3 p-3" role="dialog">
      <div className="flex items-start justify-between gap-3">
        <div className="grid gap-0.5">
          <strong className="text-sm font-semibold">块评论</strong>
          <span className="text-xs text-muted-foreground">围绕当前内容继续讨论</span>
        </div>
        <Badge variant="outline">{block.comments.length}</Badge>
      </div>
      <div className="block-comment-list">
        {block.comments.length > 0 ? (
          block.comments.map((comment) => (
            <article
              className={comment.resolved ? "block-comment-item block-comment-item-resolved" : "block-comment-item"}
              key={comment.id}
            >
              <div className="block-comment-meta">
                <strong>{comment.author}</strong>
                <span>{comment.time}</span>
              </div>
              <div className="block-comment-state-row">
                <Badge variant={comment.resolved ? "success" : "warning"}>
                  {comment.resolved ? "已解决" : "待处理"}
                </Badge>
                {!comment.resolved && !isReadOnly ? (
                  <Button
                    className="h-7 px-2 text-[11px]"
                    onClick={() => onResolveComment(block.id, comment.id)}
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    标记解决
                  </Button>
                ) : null}
              </div>
              <p>{comment.body}</p>
            </article>
          ))
        ) : (
          <p className="block-comment-empty">还没有评论</p>
        )}
      </div>
      {!isReadOnly ? (
        <form className="block-comment-compose" onSubmit={handleSubmit}>
          <Textarea
            aria-label="添加块评论"
            className="min-h-20 resize-none"
            onChange={(event) => onChangeCommentDraft(event.target.value)}
            placeholder="写下需要协作的点"
            rows={3}
            value={commentDraft}
          />
          <Button className="h-8" disabled={!commentDraft.trim()} size="sm" type="submit">
            发布评论
          </Button>
        </form>
      ) : null}
    </div>
  );
}
