import { Trash2 } from "lucide-react";
import type { EditorDocument } from "../model/block";

interface WorkspaceSidebarProps {
  activeDocumentId: string;
  documents: EditorDocument[];
  onCreateDocument: () => void;
  onDeleteDocument: (documentId: string) => void;
  onSelectDocument: (documentId: string) => void;
}

function getDocumentTitle(document: EditorDocument) {
  return document.title.trim() || "未命名文档";
}

export function WorkspaceSidebar({
  activeDocumentId,
  documents,
  onCreateDocument,
  onDeleteDocument,
  onSelectDocument,
}: WorkspaceSidebarProps) {
  const canDeleteDocument = documents.length > 1;

  return (
    <aside aria-label="工作区页面" className="workspace-sidebar">
      <div className="workspace-head">
        <div aria-hidden="true" className="workspace-mark">
          N
        </div>
        <div className="workspace-name">
          <strong>团队知识库</strong>
          <span>4 人在线协作</span>
        </div>
      </div>

      <div className="quick-actions">
        <button className="sidebar-action" type="button">
          <span aria-hidden="true" className="sidebar-icon">
            ⌕
          </span>
          快速搜索
        </button>
        <button className="sidebar-action" onClick={onCreateDocument} type="button">
          <span aria-hidden="true" className="sidebar-icon">
            ＋
          </span>
          新建文档
        </button>
        <button className="sidebar-action" type="button">
          <span aria-hidden="true" className="sidebar-icon">
            ◷
          </span>
          最近更新
        </button>
      </div>

      <p className="section-label">项目空间</p>
      <ul className="page-tree">
        {documents.map((document) => {
          const isActive = document.id === activeDocumentId;
          const title = getDocumentTitle(document);

          return (
            <li key={document.id}>
              <div className="page-link-row">
                <button
                  aria-current={isActive ? "page" : undefined}
                  className={`page-link${isActive ? " active" : ""}`}
                  data-testid={`document-nav-${document.id}`}
                  onClick={() => onSelectDocument(document.id)}
                  type="button"
                >
                  <span className="page-link-main">
                    <span aria-hidden="true" className="sidebar-icon">
                      {isActive ? "▾" : "◦"}
                    </span>
                    <span className="page-title">{title}</span>
                  </span>
                  <span className="page-meta">{document.blocks.length}</span>
                </button>
                <button
                  aria-label={`删除文档 ${title}`}
                  className="page-delete-button"
                  data-tooltip="删除文档"
                  disabled={!canDeleteDocument}
                  onClick={() => onDeleteDocument(document.id)}
                  type="button"
                >
                  <Trash2 aria-hidden="true" size={14} />
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      <div className="sidebar-footer">
        <span className="sync-line">
          <span aria-hidden="true" className="online-dot" />
          本地已同步 · 12 秒前
        </span>
        <span>离线也可以继续编辑，恢复连接后同步。</span>
      </div>
    </aside>
  );
}
