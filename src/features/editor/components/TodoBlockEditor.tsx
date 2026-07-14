import { useLayoutEffect, useRef } from "react";

interface TodoBlockEditorProps {
  blockId: string;
  checked: boolean;
  content: string;
  focusRequest: boolean;
  isReadOnly: boolean;
  onToggle: () => void;
  onChange: (content: string) => void;
  onEnter: () => void;
  onFocused: () => void;
  onOpenCommandMenu: () => void;
}

export function TodoBlockEditor({
  blockId,
  checked,
  content,
  focusRequest,
  isReadOnly,
  onToggle,
  onChange,
  onEnter,
  onFocused,
  onOpenCommandMenu,
}: TodoBlockEditorProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  useLayoutEffect(() => {
    if (!focusRequest || isReadOnly) {
      return;
    }

    inputRef.current?.focus();
    onFocused();
  }, [focusRequest, isReadOnly, onFocused]);

  return (
    <div className="todo-editor">
      <input
        aria-label="待办完成状态"
        checked={checked}
        className="todo-checkbox"
        disabled={isReadOnly}
        onChange={onToggle}
        type="checkbox"
      />
      <input
        aria-label="待办内容"
        className="todo-input"
        data-testid={`block-editor-${blockId}`}
        disabled={isReadOnly}
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
        ref={inputRef}
        value={content}
      />
    </div>
  );
}
