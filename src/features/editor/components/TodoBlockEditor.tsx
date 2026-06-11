interface TodoBlockEditorProps {
  blockId: string;
  checked: boolean;
  content: string;
  onToggle: () => void;
  onChange: (content: string) => void;
  onEnter: () => void;
  onOpenCommandMenu: () => void;
}

export function TodoBlockEditor({
  blockId,
  checked,
  content,
  onToggle,
  onChange,
  onEnter,
  onOpenCommandMenu,
}: TodoBlockEditorProps) {
  return (
    <div className="todo-editor">
      <input
        aria-label="待办完成状态"
        checked={checked}
        className="todo-checkbox"
        onChange={onToggle}
        type="checkbox"
      />
      <input
        aria-label="待办内容"
        className="todo-input"
        data-testid={`block-editor-${blockId}`}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "/") {
            event.preventDefault();
            onOpenCommandMenu();
          }

          if (event.key === "Enter") {
            event.preventDefault();
            onEnter();
          }
        }}
        value={content}
      />
    </div>
  );
}
