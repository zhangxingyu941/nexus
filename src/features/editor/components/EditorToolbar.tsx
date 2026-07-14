interface EditorToolbarProps {
  saveStatus: "local" | "remote" | "saving" | "unsaved" | "failed";
}

const SAVE_STATUS_LABELS = {
  failed: "保存失败",
  local: "本地已保存",
  remote: "已同步",
  saving: "保存中",
  unsaved: "未保存",
} as const;

export function EditorToolbar({ saveStatus }: EditorToolbarProps) {
  return (
    <header className="editor-toolbar">
      <div>
        <p className="toolbar-kicker">本地工作区</p>
        <h1>未命名文档</h1>
      </div>
      <span aria-live="polite" className={`save-status save-status-${saveStatus}`}>
        {SAVE_STATUS_LABELS[saveStatus]}
      </span>
    </header>
  );
}
