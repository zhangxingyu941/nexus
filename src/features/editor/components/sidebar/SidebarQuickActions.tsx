import { Clock3, ListChecks, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";

interface SidebarQuickActionsProps {
  isReadOnly: boolean;
  onOpenActivity: () => void;
  onOpenSearch: () => void;
  onOpenTasks: () => void;
  onOpenTemplates: () => void;
}

export function SidebarQuickActions({
  isReadOnly,
  onOpenActivity,
  onOpenSearch,
  onOpenTasks,
  onOpenTemplates,
}: SidebarQuickActionsProps) {
  return (
    <div className="grid gap-1 py-3">
      <Button className="h-9 w-full justify-start px-2.5 font-normal text-foreground" onClick={onOpenSearch} type="button" variant="ghost">
        <Search aria-hidden="true" className="size-4 text-muted-foreground" />
        快速搜索
      </Button>
      <Button className="h-9 w-full justify-start px-2.5 font-normal text-foreground" disabled={isReadOnly} onClick={onOpenTemplates} type="button" variant="ghost">
        <Plus aria-hidden="true" className="size-4 text-primary" />
        新建文档
      </Button>
      <Button className="h-9 w-full justify-start px-2.5 font-normal text-foreground" onClick={onOpenActivity} type="button" variant="ghost">
        <Clock3 aria-hidden="true" className="size-4 text-muted-foreground" />
        最近更新
      </Button>
      <Button className="h-9 w-full justify-start px-2.5 font-normal text-foreground" onClick={onOpenTasks} type="button" variant="ghost">
        <ListChecks aria-hidden="true" className="size-4 text-muted-foreground" />
        任务中心
      </Button>
    </div>
  );
}
