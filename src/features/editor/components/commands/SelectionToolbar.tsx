import type { CSSProperties } from "react";

export interface SelectionToolbarProps {
  anchor: { left: number; top: number } | null;
  canLink: boolean;
  onBold: () => void;
  onComment?: () => void;
  onItalic: () => void;
  onLink: () => void;
  onStrike: () => void;
}

export function SelectionToolbar({
  anchor,
  canLink,
  onBold,
  onComment,
  onItalic,
  onLink,
  onStrike,
}: SelectionToolbarProps) {
  if (!anchor) {
    return null;
  }

  const style: CSSProperties = {
    left: anchor.left,
    top: anchor.top,
    transform: "translate(-50%, -100%)",
  };

  return (
    <div
      aria-label="文字工具"
      className="selection-toolbar"
      role="toolbar"
      style={style}
    >
      <button className="selection-toolbar-button" onClick={onBold} type="button">
        <strong>B</strong>
      </button>
      <button className="selection-toolbar-button" onClick={onItalic} type="button">
        <em>I</em>
      </button>
      <button className="selection-toolbar-button" onClick={onStrike} type="button">
        <s>S</s>
      </button>
      <span aria-hidden="true" className="selection-toolbar-divider" />
      <button
        className="selection-toolbar-button"
        disabled={!canLink}
        onClick={onLink}
        type="button"
      >
        链接
      </button>
      {onComment ? (
        <button className="selection-toolbar-button" onClick={onComment} type="button">
          评论
        </button>
      ) : null}
    </div>
  );
}
