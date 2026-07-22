import type { CollaborationDocument } from "../collaboration/collaborationTypes";
import type { BlockType, HeadingLevel } from "../model/block";
import type { RichTextDocument, RichTextUpdate } from "@/shared/richText";
import type { EditorSessionUser } from "../session/sessionTypes";
import type { EditorPopoverAnchor } from "./commands/EditorCommandPopover";
import type { MentionItem } from "./commands/useMentionSearch";
import { RichTextBlockEditor } from "./RichTextBlockEditor";

interface TodoBlockEditorProps {
  blockId: string;
  checked: boolean;
  collaborationDocument: CollaborationDocument | null;
  content: string;
  richText: RichTextDocument | null;
  focusRequest: boolean;
  isReadOnly: boolean;
  onToggle: () => void;
  onChange: (update: RichTextUpdate) => void;
  onEnter: () => void;
  onFocused: () => void;
  onMarkdownShortcut: (type: BlockType, headingLevel?: HeadingLevel) => void;
  onOpenCommandMenu: (anchor: EditorPopoverAnchor) => void;
  onOpenMentionMenu?: (anchor: EditorPopoverAnchor) => void;
  onMentionApiReady?: (api: { insertMention: (item: MentionItem) => void }) => void;
  sessionUser?: { id: string; name: string; color: string };
}

export function TodoBlockEditor({
  blockId,
  checked,
  collaborationDocument,
  content,
  richText,
  focusRequest,
  isReadOnly,
  onToggle,
  onChange,
  onEnter,
  onFocused,
  onMarkdownShortcut,
  onOpenCommandMenu,
  onOpenMentionMenu,
  onMentionApiReady,
  sessionUser,
}: TodoBlockEditorProps) {
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
      <RichTextBlockEditor
        ariaLabel="待办内容"
        blockId={blockId}
        collaborationDocument={collaborationDocument}
        content={content}
        focusRequest={focusRequest}
        isReadOnly={isReadOnly}
        onChange={onChange}
        onEnter={onEnter}
        onFocused={onFocused}
        onMarkdownShortcut={onMarkdownShortcut}
        onOpenCommandMenu={onOpenCommandMenu}
        onOpenMentionMenu={onOpenMentionMenu}
        onMentionApiReady={onMentionApiReady}
        richText={richText}
        sessionUser={sessionUser}
        variant="todo"
      />
    </div>
  );
}
