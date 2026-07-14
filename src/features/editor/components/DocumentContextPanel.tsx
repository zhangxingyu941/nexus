import { BookOpen, CheckCircle2, Circle, FileText, Users, X } from "lucide-react";
import type { Block, EditorDocument } from "../model/block";

interface DocumentContextPanelProps {
  document: EditorDocument;
  commentCount: number;
  isOpen: boolean;
  onClose: () => void;
}

function getDocumentTitle(document: EditorDocument) {
  return document.title.trim() || "未命名文档";
}

function scrollToBlock(blockId: string) {
  document.querySelector(`[data-testid="block-row-${blockId}"]`)?.scrollIntoView({
    behavior: "smooth",
    block: "center",
  });
}

function scrollToTitle() {
  document.querySelector<HTMLTextAreaElement>(".document-title-input")?.focus();
}

function getBlockLabel(block: Block) {
  return block.content.trim() || "未命名标题";
}

const STATUS_LABELS = {
  done: "已完成",
  "in-progress": "进行中",
  review: "待评审",
  todo: "待处理",
  unset: "未设置",
} as const;

export function DocumentContextPanel({ document, commentCount, isOpen, onClose }: DocumentContextPanelProps) {
  // 右侧信息栏完全由当前文档派生，避免协作状态与正文内容出现两套数据源。
  const headings = document.blocks.filter((block) => block.type === "heading");
  const todoBlocks = document.blocks.filter((block) => block.type === "todo");
  const collaborationBlocks = document.blocks.filter(
    (block) => block.assignee || block.dueDate || block.status !== "unset",
  );
  const completedTodoCount = todoBlocks.filter((block) => block.checked).length;
  const todoPercent =
    todoBlocks.length > 0 ? Math.round((completedTodoCount / todoBlocks.length) * 100) : 0;
  const title = getDocumentTitle(document);

  return (
    <aside
      aria-label="文档侧栏"
      className={`document-context-panel${isOpen ? " document-context-panel-open" : ""}`}
    >
      <div className="mobile-context-header">
        <strong>文档信息</strong>
        <button aria-label="关闭文档信息面板" onClick={onClose} type="button">
          <X aria-hidden="true" size={18} />
        </button>
      </div>
      <section className="context-card context-summary-card">
        <div className="context-title-row">
          <span aria-hidden="true" className="context-icon context-icon-blue">
            <FileText size={16} />
          </span>
          <div>
            <p className="panel-kicker">当前文档</p>
            <h2>{title}</h2>
          </div>
        </div>
        <div className="context-metrics">
          <span>
            <strong>{document.blocks.length}</strong>
            内容块
          </span>
          <span>
            <strong>{commentCount}</strong>
            评论
          </span>
        </div>
      </section>

      <section className="context-card">
        <div className="context-title-row">
          <span aria-hidden="true" className="context-icon context-icon-green">
            <BookOpen size={16} />
          </span>
          <h2>文档大纲</h2>
        </div>
        <nav aria-label="文档大纲" className="outline-list">
          <button className="outline-item outline-item-title" onClick={scrollToTitle} type="button">
            {title}
          </button>
          {headings.length > 0 ? (
            headings.map((block) => (
              <button
                className="outline-item"
                key={block.id}
                onClick={() => scrollToBlock(block.id)}
                type="button"
              >
                {getBlockLabel(block)}
              </button>
            ))
          ) : (
            <p className="context-empty">暂无标题块</p>
          )}
        </nav>
      </section>

      <section className="context-card">
        <div className="context-title-row">
          <span aria-hidden="true" className="context-icon context-icon-amber">
            <CheckCircle2 size={16} />
          </span>
          <h2>待办进度</h2>
        </div>
        <div className="todo-progress-head">
          <strong>{completedTodoCount} / {todoBlocks.length}</strong>
          <span>{todoPercent}%</span>
        </div>
        <div aria-hidden="true" className="todo-progress-bar">
          <span style={{ width: `${todoPercent}%` }} />
        </div>
        {todoBlocks.length > 0 ? (
          <div className="context-task-list">
            {todoBlocks.slice(0, 3).map((block) => (
              <span className={block.checked ? "context-task done" : "context-task"} key={block.id}>
                {block.checked ? <CheckCircle2 aria-hidden="true" size={14} /> : <Circle aria-hidden="true" size={14} />}
                {block.content.trim() || "未命名待办"}
              </span>
            ))}
          </div>
        ) : (
          <p className="context-empty">暂无待办项</p>
        )}
      </section>

      <section className="context-card">
        <div className="context-title-row">
          <span aria-hidden="true" className="context-icon context-icon-blue">
            <Users size={16} />
          </span>
          <h2>协作状态</h2>
        </div>
        <div className="collab-feed">
          {collaborationBlocks.length > 0 ? (
            collaborationBlocks.slice(0, 5).map((block) => (
              <button key={block.id} onClick={() => scrollToBlock(block.id)} type="button">
                <strong>{block.assignee || "未分配"}</strong>
                <span>{STATUS_LABELS[block.status]}</span>
                <small>{block.dueDate || "未设截止"} · {getBlockLabel(block)}</small>
              </button>
            ))
          ) : (
            <p className="context-empty">暂无块级协作状态</p>
          )}
        </div>
      </section>
    </aside>
  );
}
