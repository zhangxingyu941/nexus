import type { BlockType, EditorDocument, MoveDirection } from "../model/block";
import { BlockList } from "./BlockList";

interface DocumentEditorProps {
  document: EditorDocument;
  saveStatus: "saved" | "saving" | "unsaved" | "failed";
  onAddAfter: (blockId: string) => void;
  onChangeContent: (blockId: string, content: string) => void;
  onChangeType: (blockId: string, type: BlockType) => void;
  onDelete: (blockId: string) => void;
  onMove: (blockId: string, direction: MoveDirection) => void;
  onToggleTodo: (blockId: string) => void;
}

const SAVE_STATUS_LABELS = {
  failed: "保存失败",
  saved: "已保存",
  saving: "保存中",
  unsaved: "未保存",
} as const;

function getDocumentTitle(document: EditorDocument) {
  return document.title.trim() || "未命名文档";
}

export function DocumentEditor({
  document,
  saveStatus,
  onAddAfter,
  onChangeContent,
  onChangeType,
  onDelete,
  onMove,
  onToggleTodo,
}: DocumentEditorProps) {
  const title = getDocumentTitle(document);

  return (
    <main className="main-pane">
      <header className="topbar">
        <div className="breadcrumb">
          <span>团队知识库</span>
          <span>/</span>
          <strong>{title}</strong>
        </div>

        <div aria-label="协作操作" className="collab-tools">
          <div aria-label="在线成员" className="presence">
            <span className="avatar green">林</span>
            <span className="avatar blue">周</span>
            <span className="avatar red">陈</span>
          </div>
          <button className="ghost-button" type="button">
            评论 3
          </button>
          <button className="ghost-button" type="button">
            历史
          </button>
          <button className="share-button" type="button">
            分享
          </button>
        </div>
      </header>

      <div className="document-scroll">
        <article aria-label="文档编辑区" className="document">
          <div className="document-cover" />
          <div aria-hidden="true" className="document-icon">
            ▦
          </div>

          <div className="title-row">
            <h1>{title}</h1>
            <span aria-live="polite" className={`doc-status doc-status-${saveStatus}`}>
              {SAVE_STATUS_LABELS[saveStatus]}
            </span>
          </div>

          <div className="doc-meta">
            <span className="meta-pill">负责人 林夏</span>
            <span className="meta-pill">最后编辑 10:42</span>
            <span className="meta-pill">3 条评论待处理</span>
          </div>

          <BlockList
            blocks={document.blocks}
            onAddAfter={onAddAfter}
            onChangeContent={onChangeContent}
            onChangeType={onChangeType}
            onDelete={onDelete}
            onMove={onMove}
            onToggleTodo={onToggleTodo}
          />

          <div className="slash-hint">
            <span className="slash-key">/</span>
            插入标题、待办、引用或协作评论
          </div>
        </article>
      </div>
    </main>
  );
}
