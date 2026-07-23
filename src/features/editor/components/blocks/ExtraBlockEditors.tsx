import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { BlockData, BlockType } from "../../model/block";

interface DividerEditorProps {
  isReadOnly: boolean;
}

export function DividerEditor({ isReadOnly }: DividerEditorProps) {
  return (
    <div className="divider-block" role="separator" aria-orientation="horizontal">
      <hr aria-hidden="true" />
      {isReadOnly ? null : null}
    </div>
  );
}

interface ListBlockEditorProps {
  content: string;
  isReadOnly: boolean;
  type: "bulletedList" | "numberedList";
  onChange: (content: string) => void;
  onEnter: (type: "bulletedList" | "numberedList") => void;
}

export function ListBlockEditor({ content, isReadOnly, type, onChange, onEnter }: ListBlockEditorProps) {
  const ordered = type === "numberedList";
  const editorRef = useRef<HTMLTextAreaElement | null>(null);
  const resizeEditor = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;

    editor.style.height = "0px";
    editor.style.height = `${editor.scrollHeight}px`;
  }, []);

  useLayoutEffect(() => {
    resizeEditor();
  }, [content, resizeEditor]);

  useLayoutEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", resizeEditor);
      return () => window.removeEventListener("resize", resizeEditor);
    }

    const observer = new ResizeObserver(resizeEditor);
    observer.observe(editor);
    return () => observer.disconnect();
  }, [resizeEditor]);

  const editor = (
    <textarea
      aria-label="列表项"
      disabled={isReadOnly}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          onEnter(type);
        }
      }}
      ref={editorRef}
      rows={1}
      value={content}
      wrap="soft"
    />
  );

  return (
    <div className={`list-block list-block-${type}`}>
      {ordered ? (
        <ol>
          <li>{editor}</li>
        </ol>
      ) : (
        <ul>
          <li>{editor}</li>
        </ul>
      )}
    </div>
  );
}

interface ToggleBlockEditorProps {
  content: string;
  data: BlockData | null;
  isReadOnly: boolean;
  onChange: (content: string) => void;
  onChangeData: (data: BlockData) => void;
}

export function ToggleBlockEditor({ content, data, isReadOnly, onChange, onChangeData }: ToggleBlockEditorProps) {
  const collapsed = data?.kind === "toggle" ? data.collapsed : false;

  return (
    <details className="toggle-block" open={!collapsed}>
      <summary
        aria-label="切换折叠"
        onClick={(event) => {
          event.preventDefault();
          onChangeData({ kind: "toggle", collapsed: !collapsed });
        }}
      >
        折叠块
      </summary>
      <textarea
        aria-label="折叠内容"
        disabled={isReadOnly}
        onChange={(event) => onChange(event.target.value)}
        value={content}
      />
    </details>
  );
}

interface FormulaBlockEditorProps {
  content: string;
  isReadOnly: boolean;
  onChange: (content: string) => void;
}

export function FormulaBlockEditor({ content, isReadOnly, onChange }: FormulaBlockEditorProps) {
  return (
    <div className="formula-block">
      <span aria-hidden="true" className="formula-block-prefix">𝑓(𝑥) =</span>
      <input
        aria-label="公式"
        disabled={isReadOnly}
        onChange={(event) => onChange(event.target.value)}
        placeholder="输入 LaTeX，如 x^2 + 1"
        value={content}
      />
      {content ? <span className="formula-block-render" aria-label="公式预览">{content}</span> : null}
    </div>
  );
}

interface LinkCardBlockEditorProps {
  content: string;
  data: BlockData | null;
  isReadOnly: boolean;
  onChange: (content: string) => void;
  onChangeData: (data: BlockData) => void;
}

export function LinkCardBlockEditor({ content, data, isReadOnly, onChange, onChangeData }: LinkCardBlockEditorProps) {
  const cardData = data?.kind === "linkCard" ? data : null;
  const [urlDraft, setUrlDraft] = useState(content);

  const commit = () => {
    const url = urlDraft.trim();
    if (!url) {
      return;
    }
    onChangeData({
      description: cardData?.description ?? "",
      kind: "linkCard",
      title: cardData?.title ?? url,
      url,
    });
    onChange(url);
  };

  if (cardData?.url) {
    return (
      <a aria-label="链接卡片" className="link-card-block" href={cardData.url} rel="noreferrer" target="_blank">
        <span className="link-card-favicon" aria-hidden="true">🔗</span>
        <span className="link-card-meta">
          <strong>{cardData.title}</strong>
          {cardData.description ? <span>{cardData.description}</span> : null}
          <span className="link-card-url">{cardData.url}</span>
        </span>
      </a>
    );
  }

  return (
    <div className="link-card-editor">
      <input
        aria-label="链接地址"
        disabled={isReadOnly}
        onChange={(event) => setUrlDraft(event.target.value)}
        placeholder="粘贴链接地址"
        value={urlDraft}
      />
      {!isReadOnly ? (
        <button onClick={commit} type="button">添加</button>
      ) : null}
    </div>
  );
}

export type ExtraBlockType = Extract<
  BlockType,
  "divider" | "bulletedList" | "numberedList" | "toggle" | "formula" | "linkCard"
>;
