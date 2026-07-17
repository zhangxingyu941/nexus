import { useEffect, useRef } from "react";
import type { CSSProperties } from "react";
import type { MentionItem } from "./useMentionSearch";

export type MentionTab = "all" | MentionItem["kind"];

export interface MentionPopoverProps {
  activeIndex: number;
  activeTab?: MentionTab;
  anchor: { bottom: number; left: number; top: number };
  items: MentionItem[];
  onSelect: (item: MentionItem) => void;
  onTabChange?: (tab: MentionTab) => void;
  query: string;
}

const MENTION_TABS: Array<{ kind: MentionTab; label: string }> = [
  { kind: "all", label: "全部" },
  { kind: "person", label: "人员" },
  { kind: "document", label: "文档" },
  { kind: "task", label: "任务" },
  { kind: "date", label: "日期" },
];

const MENTION_GROUPS: Array<{ kind: MentionItem["kind"]; label: string }> = [
  { kind: "person", label: "人员" },
  { kind: "document", label: "文档" },
  { kind: "task", label: "任务" },
  { kind: "date", label: "日期" },
];

export function MentionPopover({
  activeIndex,
  activeTab = "all",
  anchor,
  items,
  onSelect,
  onTabChange,
  query,
}: MentionPopoverProps) {
  const listboxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const active = listboxRef.current?.querySelector('[aria-selected="true"]');
    if (active && typeof active.scrollIntoView === "function") {
      active.scrollIntoView({ block: "nearest" });
    }
  }, [activeIndex]);

  const visibleItems = activeTab === "all" ? items : items.filter((item) => item.kind === activeTab);

  const viewportHeight = typeof window === "undefined" ? 768 : window.innerHeight;
  const viewportWidth = typeof window === "undefined" ? 1024 : window.innerWidth;
  const side = viewportHeight - anchor.bottom >= 320 ? "bottom" : "top";
  const style: CSSProperties = {
    left: Math.max(12, Math.min(anchor.left, viewportWidth - 402)),
    top: side === "bottom" ? anchor.bottom + 8 : anchor.top - 8,
    transform: side === "top" ? "translateY(-100%)" : undefined,
  };

  return (
    <div
      aria-label="提及"
      className="editor-command-popover"
      data-side={side}
      ref={listboxRef}
      role="listbox"
      style={style}
    >
      <div className="mention-tabs" role="tablist">
        {MENTION_TABS.map((tab) => (
          <button
            aria-selected={tab.kind === activeTab}
            className={`mention-tab${tab.kind === activeTab ? " active" : ""}`}
            key={tab.kind}
            onClick={() => onTabChange?.(tab.kind)}
            role="tab"
            type="button"
          >
            {tab.label}
          </button>
        ))}
      </div>
      {query ? <div className="editor-command-query">@{query}</div> : null}
      {MENTION_GROUPS.filter((group) => activeTab === "all" || group.kind === activeTab).map((group) => {
        const groupItems = visibleItems.filter((item) => item.kind === group.kind);

        if (groupItems.length === 0) {
          return null;
        }

        return (
          <section aria-label={`${group.label}分组`} className="editor-command-group" key={group.kind}>
            <div className="editor-command-group-label">{group.label}</div>
            {groupItems.map((item) => {
              const index = visibleItems.indexOf(item);

              return (
                <button
                  aria-label={`${item.label}${item.subtext ? ` ${item.subtext}` : ""}`}
                  aria-selected={index === activeIndex}
                  className="editor-command-option"
                  key={item.id}
                  onClick={() => onSelect(item)}
                  onPointerDown={(event) => event.preventDefault()}
                  role="option"
                  type="button"
                >
                  <span className="editor-command-copy">
                    <strong>{item.label}</strong>
                    {item.subtext ? <span>{item.subtext}</span> : null}
                  </span>
                </button>
              );
            })}
          </section>
        );
      })}
      {visibleItems.length === 0 ? <div className="editor-command-empty">无匹配结果</div> : null}
    </div>
  );
}
