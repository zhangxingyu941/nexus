import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  EDITOR_SHORTCUTS,
  formatShortcutKeys,
  type EditorShortcutCategory,
} from "../../commands/editorShortcuts";

const SHORTCUT_CATEGORIES: Array<{ id: EditorShortcutCategory; label: string }> = [
  { id: "format", label: "格式" },
  { id: "block", label: "块操作" },
  { id: "navigation", label: "导航" },
  { id: "workspace", label: "工作区" },
];

interface EditorShortcutCenterProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
}

function isApplePlatform(): boolean {
  if (typeof navigator === "undefined") {
    return false;
  }

  return /Mac|iPhone|iPad|iPod/.test(navigator.platform);
}

export function EditorShortcutCenter({ isOpen, onOpenChange }: EditorShortcutCenterProps) {
  const isMac = isApplePlatform();

  return (
    <Dialog onOpenChange={onOpenChange} open={isOpen}>
      <DialogContent className="shortcut-center max-h-[min(42rem,calc(100dvh-2rem))] max-w-2xl overflow-hidden p-0">
        <DialogHeader className="border-b px-5 py-4 pr-12">
          <DialogTitle>快捷键</DialogTitle>
          <DialogDescription>编辑器使用固定快捷键，当前暂不支持自定义。</DialogDescription>
        </DialogHeader>

        <div className="shortcut-center-groups overflow-y-auto px-5 py-4">
          {SHORTCUT_CATEGORIES.map((category) => {
            const shortcuts = EDITOR_SHORTCUTS.filter((shortcut) => shortcut.category === category.id);

            return (
              <section className="shortcut-center-group" key={category.id}>
                <h2>{category.label}</h2>
                <div className="shortcut-center-list">
                  {shortcuts.map((shortcut) => (
                    <div className="shortcut-center-row" key={shortcut.id}>
                      <span>{shortcut.description}</span>
                      <span aria-label={shortcut.keys.join(" + ")} className="shortcut-center-keys">
                        {formatShortcutKeys(shortcut.keys, isMac).map((key, index) => (
                          <span className="shortcut-center-key" key={`${shortcut.id}-${key}-${index}`}>
                            {index > 0 ? <span aria-hidden="true">+</span> : null}
                            <kbd>{key}</kbd>
                          </span>
                        ))}
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
