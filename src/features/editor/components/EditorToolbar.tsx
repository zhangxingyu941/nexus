interface EditorToolbarProps {
  saveStatus: "Saved" | "Saving" | "Unsaved" | "Save failed";
}

export function EditorToolbar({ saveStatus }: EditorToolbarProps) {
  return (
    <header className="editor-toolbar">
      <div>
        <p className="toolbar-kicker">Local workspace</p>
        <h1>Untitled</h1>
      </div>
      <span className={`save-status save-status-${saveStatus.toLowerCase().replace(" ", "-")}`}>
        {saveStatus}
      </span>
    </header>
  );
}
