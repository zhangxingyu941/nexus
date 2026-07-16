import { ChevronDown } from "lucide-react";
import type { WorkspaceSummary } from "../../../../shared/workspace";
import { Button } from "@/components/ui/button";

const ROLE_LABELS = { editor: "编辑者", owner: "所有者", viewer: "访客" } as const;

interface WorkspaceSwitcherProps {
  disabled?: boolean;
  onOpen: () => void;
  workspace: WorkspaceSummary;
}

export function WorkspaceSwitcher({ disabled, onOpen, workspace }: WorkspaceSwitcherProps) {
  const initial = workspace.name.trim().charAt(0).toUpperCase() || "N";
  return (
    <Button
      aria-label={`当前工作区 ${workspace.name}，${ROLE_LABELS[workspace.role]}`}
      className="h-12 w-full justify-start gap-2.5 px-2"
      disabled={disabled}
      onClick={onOpen}
      type="button"
      variant="ghost"
    >
      <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-md border bg-background text-sm font-semibold">
        {initial}
      </span>
      <span className="grid min-w-0 flex-1 text-left">
        <span className="truncate text-sm font-medium">{workspace.name}</span>
        <span className="text-xs text-muted-foreground">{ROLE_LABELS[workspace.role]}</span>
      </span>
      <ChevronDown aria-hidden="true" className="size-4 text-muted-foreground" />
    </Button>
  );
}
