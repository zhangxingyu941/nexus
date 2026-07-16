import { useMemo, useState } from "react";
import type { EditorDocument } from "../model/block";
import type { WorkspaceSummary } from "../../../shared/workspace";
import type {
  CreateWorkspaceDocumentInput,
  WorkspaceActivity,
  WorkspaceCollaborator,
  WorkspaceSearchResult,
  WorkspaceTask,
} from "../model/workspaceOperations";
import { getSortedWorkspaceDocuments, groupWorkspaceTasksByDueDate } from "../model/workspaceOperations";
import { BrandMark } from "@/components/BrandMark";
import { Badge } from "@/components/ui/badge";
import { ActivityDialog } from "./sidebar/ActivityDialog";
import { DocumentTree } from "./sidebar/DocumentTree";
import { QuickSearchDialog } from "./sidebar/QuickSearchDialog";
import { SidebarQuickActions } from "./sidebar/SidebarQuickActions";
import { getDocumentTitle } from "./sidebar/sidebarUtils";
import type { TaskStatusFilter } from "./sidebar/sidebarUtils";
import { TaskCenterDialog } from "./sidebar/TaskCenterDialog";
import { TemplateDialog } from "./sidebar/TemplateDialog";
import { WorkspaceSwitcher } from "./sidebar/WorkspaceSwitcher";

interface WorkspaceSidebarProps {
  activeDocumentId: string;
  activities: WorkspaceActivity[];
  collaborators: WorkspaceCollaborator[];
  documents: EditorDocument[];
  getSearchResults: (query: string) => WorkspaceSearchResult[];
  isReadOnly: boolean;
  onCreateDocument: (input?: CreateWorkspaceDocumentInput) => void;
  onDeleteDocument: (documentId: string) => void;
  onDuplicateDocument: (documentId: string) => void;
  onCompleteTask: (documentId: string, blockId: string) => void;
  onOpenUtilityDialog: () => void;
  onManageWorkspaces: () => void;
  onRenameDocument: (documentId: string) => void;
  onSelectDocument: (documentId: string) => void;
  onSelectTask: (documentId: string, blockId: string) => void;
  onToggleDocumentPinned: (documentId: string) => void;
  tasks: WorkspaceTask[];
  workspaceSummary: WorkspaceSummary;
}

export function WorkspaceSidebar({
  activeDocumentId,
  activities,
  documents,
  getSearchResults,
  isReadOnly,
  onCreateDocument,
  onDeleteDocument,
  onDuplicateDocument,
  onCompleteTask,
  onOpenUtilityDialog,
  onManageWorkspaces,
  onRenameDocument,
  onSelectDocument,
  onSelectTask,
  onToggleDocumentPinned,
  tasks,
  workspaceSummary,
}: WorkspaceSidebarProps) {
  const canDeleteDocument = documents.length > 1;
  const [openActionDocumentId, setOpenActionDocumentId] = useState<string | null>(null);
  const [isActivityOpen, setIsActivityOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isTaskCenterOpen, setIsTaskCenterOpen] = useState(false);
  const [isTemplateDialogOpen, setIsTemplateDialogOpen] = useState(false);
  const [taskAssigneeFilter, setTaskAssigneeFilter] = useState("all");
  const [taskStatusFilter, setTaskStatusFilter] = useState<TaskStatusFilter>("all");
  const [documentFilter, setDocumentFilter] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const openDocumentFinder = () => {
    onOpenUtilityDialog();
    setIsActivityOpen(false);
    setIsTaskCenterOpen(false);
    setIsTemplateDialogOpen(false);
    setSearchQuery("");
    setIsSearchOpen(true);
  };

  const openActivityCenter = () => {
    onOpenUtilityDialog();
    setIsSearchOpen(false);
    setIsTaskCenterOpen(false);
    setIsTemplateDialogOpen(false);
    setIsActivityOpen(true);
  };

  const openTaskCenter = () => {
    onOpenUtilityDialog();
    setIsActivityOpen(false);
    setIsSearchOpen(false);
    setIsTemplateDialogOpen(false);
    setIsTaskCenterOpen(true);
  };

  const openTemplateCenter = () => {
    onOpenUtilityDialog();
    setIsActivityOpen(false);
    setIsSearchOpen(false);
    setIsTaskCenterOpen(false);
    setIsTemplateDialogOpen(true);
  };

  const sortedDocuments = useMemo(() => getSortedWorkspaceDocuments(documents), [documents]);
  const normalizedDocumentFilter = documentFilter.trim().toLowerCase();
  const visibleDocuments = sortedDocuments.filter((document) =>
    getDocumentTitle(document).toLowerCase().includes(normalizedDocumentFilter),
  );
  const searchCreateTitle = searchQuery.trim();
  const searchResults = getSearchResults(searchQuery);
  const taskAssignees = Array.from(new Set(tasks.map((task) => task.assignee))).sort((left, right) =>
    left.localeCompare(right, "zh-Hans-CN"),
  );
  const visibleTasks = tasks.filter((task) => {
    if (taskStatusFilter === "open" && task.status === "done") {
      return false;
    }

    if (taskStatusFilter !== "all" && taskStatusFilter !== "open" && task.status !== taskStatusFilter) {
      return false;
    }

    return taskAssigneeFilter === "all" || task.assignee === taskAssigneeFilter;
  });
  const taskGroups = groupWorkspaceTasksByDueDate(visibleTasks);

  const handleSearchResultSelect = (result: WorkspaceSearchResult) => {
    if (result.blockId) {
      onSelectTask(result.documentId, result.blockId);
    } else {
      onSelectDocument(result.documentId);
    }

    setIsSearchOpen(false);
    setSearchQuery("");
  };

  const handleCreateFromSearch = () => {
    if (!searchCreateTitle) {
      return;
    }

    onCreateDocument(searchCreateTitle);
    setIsSearchOpen(false);
    setSearchQuery("");
  };

  const handleCreateFromTemplate = (input?: CreateWorkspaceDocumentInput) => {
    onCreateDocument(input);
    setIsTemplateDialogOpen(false);
  };

  const handleSelectTask = (task: WorkspaceTask) => {
    onSelectTask(task.documentId, task.blockId);
    setIsTaskCenterOpen(false);
  };

  const handleSelectActivity = (activity: WorkspaceActivity) => {
    onSelectDocument(activity.documentId);
    setIsActivityOpen(false);
  };

  return (
    <aside
      aria-label="工作区页面"
      className="workspace-sidebar sticky top-0 z-10 flex h-dvh min-w-0 flex-col overflow-y-auto border-r bg-zinc-50 p-3"
    >
      <div className="flex min-h-11 items-center gap-2.5 px-1 pb-2">
        <BrandMark className="size-8 shadow-sm" />
        <div className="grid min-w-0 flex-1">
          <strong className="truncate text-sm font-semibold text-foreground">Nexus</strong>
          <span className="truncate text-xs text-muted-foreground">内容与项目协作</span>
        </div>
        <Badge className="border-emerald-200 bg-emerald-50 px-1.5 text-[10px] text-emerald-700" variant="outline">在线</Badge>
      </div>

      <div className="border-b border-border/70 pb-2">
        <WorkspaceSwitcher onOpen={onManageWorkspaces} workspace={workspaceSummary} />
      </div>

      <SidebarQuickActions
        isReadOnly={isReadOnly}
        onOpenActivity={openActivityCenter}
        onOpenSearch={openDocumentFinder}
        onOpenTasks={openTaskCenter}
        onOpenTemplates={openTemplateCenter}
      />

      <DocumentTree
        activeDocumentId={activeDocumentId}
        canDeleteDocument={canDeleteDocument}
        documentFilter={documentFilter}
        documents={visibleDocuments}
        isReadOnly={isReadOnly}
        openActionDocumentId={openActionDocumentId}
        totalDocumentCount={documents.length}
        onClearFilter={() => setDocumentFilter("")}
        onDeleteDocument={onDeleteDocument}
        onDuplicateDocument={onDuplicateDocument}
        onRenameDocument={onRenameDocument}
        onSelectDocument={onSelectDocument}
        onSetDocumentFilter={setDocumentFilter}
        onSetOpenActionDocumentId={setOpenActionDocumentId}
        onToggleDocumentPinned={onToggleDocumentPinned}
      />

      <div className="mt-auto grid gap-1.5 border-t border-border/70 px-2 pt-3 text-xs leading-5 text-muted-foreground">
        <span className="flex items-center gap-2 font-medium text-foreground">
          <span aria-hidden="true" className="size-1.5 rounded-full bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.12)]" />
          工作区已同步
        </span>
        <span>离线修改会在恢复连接后同步。</span>
      </div>

      {isSearchOpen ? (
        <QuickSearchDialog
          isReadOnly={isReadOnly}
          query={searchQuery}
          results={searchResults}
          searchCreateTitle={searchCreateTitle}
          onChangeQuery={setSearchQuery}
          onClose={() => setIsSearchOpen(false)}
          onCreateFromSearch={handleCreateFromSearch}
          onSelectResult={handleSearchResultSelect}
        />
      ) : null}

      {isActivityOpen ? (
        <ActivityDialog
          activities={activities}
          onClose={() => setIsActivityOpen(false)}
          onSelectActivity={handleSelectActivity}
        />
      ) : null}

      {isTemplateDialogOpen ? (
        <TemplateDialog
          onClose={() => setIsTemplateDialogOpen(false)}
          onCreateFromTemplate={handleCreateFromTemplate}
        />
      ) : null}

      {isTaskCenterOpen ? (
        <TaskCenterDialog
          assigneeFilter={taskAssigneeFilter}
          assignees={taskAssignees}
          groups={taskGroups}
          isReadOnly={isReadOnly}
          statusFilter={taskStatusFilter}
          taskCount={tasks.length}
          onChangeAssigneeFilter={setTaskAssigneeFilter}
          onChangeStatusFilter={setTaskStatusFilter}
          onClose={() => setIsTaskCenterOpen(false)}
          onCompleteTask={onCompleteTask}
          onSelectTask={handleSelectTask}
        />
      ) : null}
    </aside>
  );
}
