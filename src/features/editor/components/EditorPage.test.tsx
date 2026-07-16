import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import type { EditorWorkspace } from "../model/block";
import { createDemoWorkspaceFixture } from "../../../test/fixtures/workspace";
import { createDefaultWorkspace, createWorkspaceDocument } from "../model/workspaceOperations";
import { EditorPage } from "./EditorPage";

async function renderEditor({
  role = "owner",
  seedFixture = true,
  workspace,
}: {
  role?: "owner" | "editor" | "viewer";
  seedFixture?: boolean;
  workspace?: EditorWorkspace;
} = {}) {
  const initialWorkspace = workspace ?? (seedFixture ? createDemoWorkspaceFixture() : createDefaultWorkspace(1000));
  function ControlledEditor() {
    const [current, setCurrent] = useState(initialWorkspace);
    return (
      <EditorPage
        membersEnabled={false}
        onManageWorkspaces={vi.fn()}
        onWorkspaceChange={(updater) => setCurrent(updater)}
        saveStatus={role === "viewer" ? "readonly" : "local"}
        workspace={current}
        workspaceId="workspace-test"
        workspaceSummary={{ createdAt: 1000, id: "workspace-test", name: "Nexus 工作区", role, updatedAt: current.updatedAt }}
      />
    );
  }
  render(<ControlledEditor />);
  await screen.findByLabelText("文档标题");
}

async function getRows() {
  return screen.findAllByTestId(/^block-row-/);
}

async function getDocumentButtons() {
  return screen.findAllByTestId(/^document-nav-/);
}

async function createBlankDocument(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "新建文档" }));
  const dialog = screen.getByRole("dialog", { name: "新建文档" });
  await user.click(within(dialog).getByRole("button", { name: /空白文档/ }));
  await screen.findByDisplayValue("未命名文档");
}

describe("EditorPage", () => {
  beforeEach(() => undefined);

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders a collaborative workspace shell with an editable document", async () => {
    await renderEditor({ seedFixture: false });

    expect(within(screen.getByLabelText("工作区页面")).getByText("Nexus")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "当前工作区 Nexus 工作区，所有者" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "新建文档" })).toBeInTheDocument();
    expect(screen.getByText("项目空间")).toBeInTheDocument();
    expect(screen.getByLabelText("协作操作")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "评论 0" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "分享" })).toBeInTheDocument();
    expect(screen.getByLabelText("文档编辑区")).toBeInTheDocument();
    expect(screen.getByLabelText("文档标题")).toHaveValue("未命名文档");
    expect(await getDocumentButtons()).toHaveLength(1);
    expect(screen.queryByText("负责人 林夏")).not.toBeInTheDocument();
    expect(screen.queryByText("最后编辑 10:42")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("块类型")).not.toBeInTheDocument();
    expect(screen.getAllByLabelText("打开块菜单").length).toBeGreaterThan(0);
  });

  it("opens and closes the responsive workspace navigation", async () => {
    const user = userEvent.setup();
    await renderEditor();

    const navigationButton = screen.getByRole("button", { name: "打开工作区导航" });
    const appShell = screen.getByLabelText("工作区页面").closest(".app-shell");

    expect(navigationButton).toHaveAttribute("aria-expanded", "false");
    expect(appShell).not.toHaveClass("sidebar-open");

    await user.click(navigationButton);

    expect(screen.getByRole("button", { name: "关闭工作区导航" })).toHaveAttribute("aria-expanded", "true");
    expect(appShell).toHaveClass("sidebar-open");

    await user.click(screen.getByLabelText("关闭工作区导航遮罩"));

    expect(screen.getByRole("button", { name: "打开工作区导航" })).toHaveAttribute("aria-expanded", "false");
    expect(appShell).not.toHaveClass("sidebar-open");
  });

  it("closes the responsive workspace navigation when opening a utility dialog", async () => {
    const user = userEvent.setup();
    await renderEditor();

    const appShell = screen.getByLabelText("工作区页面").closest(".app-shell");
    await user.click(screen.getByRole("button", { name: "打开工作区导航" }));
    await user.click(screen.getByRole("button", { name: "任务中心" }));

    expect(appShell).not.toHaveClass("sidebar-open");
    expect(screen.getByRole("dialog", { name: "任务中心" })).toBeInTheDocument();
  });

  it("opens and closes the responsive document information panel", async () => {
    const user = userEvent.setup();
    await renderEditor();

    const informationButton = screen.getByRole("button", { name: "打开文档信息" });

    expect(informationButton).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByLabelText("文档侧栏")).not.toHaveClass("document-context-panel-open");

    await user.click(informationButton);

    expect(screen.getByRole("button", { name: "关闭文档信息" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByLabelText("文档侧栏")).toHaveClass("document-context-panel-open");

    await user.click(within(screen.getByLabelText("文档侧栏")).getByRole("button", { name: "关闭文档信息面板" }));

    expect(screen.getByRole("button", { name: "打开文档信息" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByLabelText("文档侧栏")).not.toHaveClass("document-context-panel-open");
  });

  it("starts with one clean document when no workspace data exists", async () => {
    await renderEditor({ seedFixture: false });

    const documentButtons = await getDocumentButtons();

    expect(documentButtons).toHaveLength(1);
    expect(documentButtons[0]).toHaveTextContent("未命名文档");
    expect(screen.queryByText("需求 PRD")).not.toBeInTheDocument();
    expect(screen.queryByText("项目计划")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "评论 0" })).toBeInTheDocument();
  });

  it("renders the controlled workspace content", async () => {
    const workspace = createWorkspaceDocument(createDefaultWorkspace(1000), 2000, "后端空间");
    await renderEditor({ workspace });

    expect(screen.getByLabelText("文档标题")).toHaveValue("后端空间");
  });

  it("renders database viewers in a read-only editor", async () => {
    const user = userEvent.setup();
    const workspace = createDefaultWorkspace(1000);
    workspace.documents[0].blocks.push({
      ...workspace.documents[0].blocks[0],
      checked: false,
      content: "只读待办",
      id: "viewer-todo",
      type: "todo",
    });
    await renderEditor({ role: "viewer", workspace });

    expect(screen.getByLabelText("文档标题")).toHaveAttribute("readonly");
    expect(screen.getByText("只读")).toBeInTheDocument();
    expect(screen.getByText("协同未启用")).toBeInTheDocument();
    expect(screen.getByLabelText("待办内容")).toBeDisabled();
    expect(screen.getByLabelText("待办完成状态")).toBeDisabled();
    expect(screen.queryByLabelText("在下方添加块")).not.toBeInTheDocument();
    expect(screen.getByLabelText("块内容")).toHaveAttribute("contenteditable", "false");
    expect(screen.getByRole("button", { name: "新建文档" })).toBeDisabled();
    expect(screen.queryAllByLabelText(/^打开文档操作 /)).toHaveLength(0);

    await user.click(screen.getByRole("button", { name: "任务中心" }));
    expect(screen.queryByRole("button", { name: /^标记完成 / })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "快速搜索" }));
    const searchDialog = screen.getByRole("dialog", { name: "快速搜索" });
    await user.type(within(searchDialog).getByLabelText("搜索工作区内容"), "只读新文档");
    expect(within(searchDialog).queryByRole("button", { name: "新建“只读新文档”" })).not.toBeInTheDocument();
  });

  it("opens a template picker and creates a new document from a template", async () => {
    const user = userEvent.setup();
    await renderEditor();

    await user.click(screen.getByRole("button", { name: "新建文档" }));
    const dialog = screen.getByRole("dialog", { name: "新建文档" });

    expect(within(dialog).getByRole("button", { name: /需求 PRD/ })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /会议纪要/ })).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: /周报/ }));

    await waitFor(async () => expect(await getDocumentButtons()).toHaveLength(5));
    const documentButtons = await getDocumentButtons();
    expect(documentButtons.some((button) => button.getAttribute("aria-current") === "page")).toBe(true);
    expect(screen.getByLabelText("文档标题")).toHaveValue("周报");
    expect(screen.getAllByText("本周进展").length).toBeGreaterThan(0);
  });

  it("adds block comments and locates them from the comments panel", async () => {
    const user = userEvent.setup();
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    await renderEditor();

    const rows = await getRows();
    await user.click(within(rows[1]).getByLabelText("打开块评论"));
    const blockCommentsDialog = screen.getByRole("dialog", { name: "块评论" });

    await user.type(within(blockCommentsDialog).getByLabelText("添加块评论"), "请补充上线风险");
    await user.click(within(blockCommentsDialog).getByRole("button", { name: "发布评论" }));

    expect(screen.getByRole("button", { name: "评论 2" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "评论 2" }));
    const commentsPanel = screen.getByRole("complementary", { name: "评论" });

    expect(within(commentsPanel).getByText("请补充上线风险")).toBeInTheDocument();
    const locateButtons = within(commentsPanel).getAllByRole("button", { name: "定位到块" });
    await user.click(locateButtons[locateButtons.length - 1]);
    expect(scrollIntoView).toHaveBeenCalled();

    await user.click(within(commentsPanel).getByRole("button", { name: "关闭评论" }));
    expect(screen.queryByRole("complementary", { name: "评论" })).not.toBeInTheDocument();
  });

  it("resolves block comments and filters comment threads", async () => {
    const user = userEvent.setup();
    await renderEditor();

    const rows = await getRows();
    await user.click(within(rows[1]).getByLabelText("打开块评论"));
    const blockCommentsDialog = screen.getByRole("dialog", { name: "块评论" });

    await user.type(within(blockCommentsDialog).getByLabelText("添加块评论"), "需要补充竞品对比");
    await user.click(within(blockCommentsDialog).getByRole("button", { name: "发布评论" }));

    expect(screen.getByRole("button", { name: "评论 2" })).toBeInTheDocument();
    const resolveButtons = within(blockCommentsDialog).getAllByRole("button", { name: "标记解决" });
    await user.click(resolveButtons[resolveButtons.length - 1]);
    expect(within(blockCommentsDialog).getByText("已解决")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "评论 1" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "评论 1" }));
    const commentsPanel = screen.getByRole("complementary", { name: "评论" });

    expect(within(commentsPanel).queryByText("需要补充竞品对比")).not.toBeInTheDocument();
    await user.click(within(commentsPanel).getByRole("tab", { name: "全部 2" }));
    expect(within(commentsPanel).getByText("需要补充竞品对比")).toBeInTheDocument();
    expect(within(commentsPanel).getByText("已解决")).toBeInTheDocument();
  });

  it("opens the share dialog, changes permission, and confirms link copy", async () => {
    const user = userEvent.setup();
    await renderEditor();

    await user.click(screen.getByRole("button", { name: "分享" }));
    const shareDialog = screen.getByRole("dialog", { name: "分享文档" });

    expect(within(shareDialog).getByRole("radio", { name: "私有" })).toBeChecked();
    await user.click(within(shareDialog).getByRole("radio", { name: "团队可查看" }));
    expect(within(shareDialog).getByRole("radio", { name: "团队可查看" })).toBeChecked();

    await user.click(within(shareDialog).getByRole("button", { name: "复制链接" }));
    expect(within(shareDialog).getByText("链接已复制")).toBeInTheDocument();
  });

  it("searches documents from the quick search dialog and switches to a result", async () => {
    const user = userEvent.setup();
    await renderEditor();

    await user.click(screen.getByRole("button", { name: "快速搜索" }));
    const searchDialog = screen.getByRole("dialog", { name: "快速搜索" });
    await user.type(within(searchDialog).getByLabelText("搜索工作区内容"), "会议");
    await user.click(within(searchDialog).getByRole("button", { name: "打开搜索结果 会议纪要" }));

    expect(screen.getByLabelText("文档标题")).toHaveValue("会议纪要");
    expect(screen.queryByRole("dialog", { name: "快速搜索" })).not.toBeInTheDocument();
  });

  it("searches block content from the quick search dialog and focuses the matching block", async () => {
    const user = userEvent.setup();
    await renderEditor();

    await user.click(screen.getByRole("button", { name: "快速搜索" }));
    const searchDialog = screen.getByRole("dialog", { name: "快速搜索" });
    await user.type(within(searchDialog).getByLabelText("搜索工作区内容"), "确认上线窗口");
    await user.click(within(searchDialog).getByRole("button", { name: "打开搜索结果 确认上线窗口 项目计划" }));

    expect(screen.getByLabelText("文档标题")).toHaveValue("项目计划");
    expect(screen.getByDisplayValue("确认上线窗口")).toHaveFocus();
    expect(screen.queryByRole("dialog", { name: "快速搜索" })).not.toBeInTheDocument();
  });

  it("creates a named document from an empty quick search result", async () => {
    const user = userEvent.setup();
    await renderEditor();

    await user.click(screen.getByRole("button", { name: "快速搜索" }));
    const searchDialog = screen.getByRole("dialog", { name: "快速搜索" });
    await user.type(within(searchDialog).getByLabelText("搜索工作区内容"), "客户成功复盘");
    await user.click(within(searchDialog).getByRole("button", { name: "新建“客户成功复盘”" }));

    await waitFor(async () => expect(await getDocumentButtons()).toHaveLength(5));
    expect(screen.getByLabelText("文档标题")).toHaveValue("客户成功复盘");
    expect(screen.queryByRole("dialog", { name: "快速搜索" })).not.toBeInTheDocument();
  });

  it("opens recent activity and switches to a document", async () => {
    const user = userEvent.setup();
    await renderEditor();

    await user.click(screen.getByRole("button", { name: "最近更新" }));

    const activityDialog = screen.getByRole("dialog", { name: "最近动态" });
    expect(within(activityDialog).getByText("协作动态")).toBeInTheDocument();
    expect(within(activityDialog).getByRole("button", { name: "打开动态 项目计划" })).toBeInTheDocument();
    expect(within(activityDialog).getByRole("button", { name: "打开动态 确认上线窗口 项目计划" })).toHaveTextContent(
      "更新了任务",
    );

    await user.click(within(activityDialog).getByRole("button", { name: "打开动态 项目计划" }));

    expect(screen.getByLabelText("文档标题")).toHaveValue("项目计划");
    expect(screen.queryByRole("dialog", { name: "最近动态" })).not.toBeInTheDocument();
  });

  it("keeps workspace utility dialogs mutually exclusive", async () => {
    const user = userEvent.setup();
    await renderEditor();

    await user.click(screen.getByRole("button", { name: "最近更新" }));
    expect(screen.getByRole("dialog", { name: "最近动态" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "新建文档" }));

    expect(screen.queryByRole("dialog", { name: "最近动态" })).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "新建文档" })).toBeInTheDocument();
  });

  it("opens a workspace task center and jumps to a task block", async () => {
    const user = userEvent.setup();
    await renderEditor();

    await user.click(screen.getByRole("button", { name: "任务中心" }));
    const taskCenter = screen.getByRole("dialog", { name: "任务中心" });

    expect(within(taskCenter).getByText("7 个行动项")).toBeInTheDocument();
    expect(within(taskCenter).getByRole("button", { name: "打开任务 确认上线窗口" })).toBeInTheDocument();

    await user.click(within(taskCenter).getByRole("button", { name: "打开任务 确认上线窗口" }));

    expect(screen.getByLabelText("文档标题")).toHaveValue("项目计划");
    expect(screen.getByDisplayValue("确认上线窗口")).toHaveFocus();
    expect(screen.queryByRole("dialog", { name: "任务中心" })).not.toBeInTheDocument();
  });

  it("groups task center items by status and due date", async () => {
    const user = userEvent.setup();
    await renderEditor();

    await user.click(screen.getByRole("button", { name: "任务中心" }));
    const taskCenter = screen.getByRole("dialog", { name: "任务中心" });

    const taskStatusTabs = within(taskCenter).getByRole("tablist", { name: "任务状态筛选" });

    expect(taskStatusTabs).toHaveClass("grid-cols-7", "min-w-[448px]");
    expect(taskStatusTabs.parentElement).toHaveClass(
      "overflow-x-auto",
      "[scrollbar-width:none]",
      "[&::-webkit-scrollbar]:hidden",
    );
    expect(within(taskCenter).getByRole("tab", { name: "待评审" })).toBeInTheDocument();
    await user.click(within(taskCenter).getByRole("tab", { name: "待处理" }));

    expect(within(taskCenter).getByText("今天", { selector: ".task-due-heading strong" })).toBeInTheDocument();
    expect(within(taskCenter).getByText("明天", { selector: ".task-due-heading strong" })).toBeInTheDocument();
    expect(within(taskCenter).getByText("本周", { selector: ".task-due-heading strong" })).toBeInTheDocument();
    expect(within(taskCenter).getByRole("button", { name: "打开任务 确认上线窗口" })).toBeInTheDocument();
    expect(within(taskCenter).queryByRole("button", { name: "打开任务 同步评审结论" })).not.toBeInTheDocument();
  });

  it("filters workspace tasks and completes a task from the task center", async () => {
    const user = userEvent.setup();
    await renderEditor();

    await user.click(screen.getByRole("button", { name: "任务中心" }));
    const taskCenter = screen.getByRole("dialog", { name: "任务中心" });

    await user.click(within(taskCenter).getByRole("tab", { name: "未完成" }));
    await user.selectOptions(within(taskCenter).getByLabelText("负责人筛选"), "周宁");

    expect(within(taskCenter).getByRole("button", { name: "打开任务 同步评审结论" })).toBeInTheDocument();
    expect(within(taskCenter).queryByRole("button", { name: "打开任务 确认核心场景" })).not.toBeInTheDocument();

    await user.click(within(taskCenter).getByRole("button", { name: "标记完成 同步评审结论" }));

    expect(within(taskCenter).queryByRole("button", { name: "打开任务 同步评审结论" })).not.toBeInTheDocument();
    await user.click(within(taskCenter).getByRole("tab", { name: "全部" }));
    expect(within(taskCenter).getByRole("button", { name: "打开任务 同步评审结论" })).toHaveTextContent("已完成");
  });

  it("pins documents and filters the sidebar with highlighted empty states", async () => {
    const user = userEvent.setup();
    await renderEditor();

    await user.click(screen.getByLabelText("打开文档操作 会议纪要"));
    await user.click(screen.getByRole("menuitem", { name: "置顶文档" }));

    await waitFor(async () => {
      const documentButtons = await getDocumentButtons();
      expect(within(documentButtons[0]).getByText("会议纪要")).toBeInTheDocument();
    });

    await user.type(screen.getByLabelText("筛选文档"), "项目");
    expect(screen.getByText("项目")).toHaveClass("search-highlight");
    expect(screen.queryByText("会议纪要")).not.toBeInTheDocument();

    await user.clear(screen.getByLabelText("筛选文档"));
    await user.type(screen.getByLabelText("筛选文档"), "不存在");
    expect(screen.getByText("没有找到匹配文档")).toBeInTheDocument();
  });

  it("opens and closes document history", async () => {
    const user = userEvent.setup();
    await renderEditor();

    await user.click(screen.getByRole("button", { name: "历史" }));
    const historyPanel = screen.getByRole("complementary", { name: "历史记录" });

    expect(within(historyPanel).getByText("需求 PRD")).toBeInTheDocument();
    expect(within(historyPanel).getByText("同步评审结论")).toBeInTheDocument();
    expect(within(historyPanel).queryByText("项目计划")).not.toBeInTheDocument();
    await user.click(within(historyPanel).getByRole("button", { name: "关闭历史记录" }));
    expect(screen.queryByRole("complementary", { name: "历史记录" })).not.toBeInTheDocument();
  });

  it("restores a database document version into the active editor", async () => {
    const user = userEvent.setup();
    const workspace = createDefaultWorkspace(1000);
    const currentDocument = {
      ...workspace.documents[0],
      title: "当前标题",
      updatedAt: 2000,
    };
    const restoredDocument = {
      ...currentDocument,
      blocks: currentDocument.blocks.map((block, index) =>
        index === 0 ? { ...block, content: "历史正文", updatedAt: 3000 } : block,
      ),
      title: "历史标题",
      updatedAt: 3000,
    };
    const databaseWorkspace = {
      ...workspace,
      documents: [currentDocument],
      updatedAt: 2000,
    };
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === `/api/workspaces/workspace-test/history/${currentDocument.id}` && init?.method === "POST") {
        return Promise.resolve(new Response(JSON.stringify({
          document: restoredDocument,
          restored: true,
        }), { status: 200 }));
      }
      if (url === `/api/workspaces/workspace-test/history/${currentDocument.id}`) {
        return Promise.resolve(new Response(JSON.stringify({
          versions: [
            { createdAt: 2000, createdBy: "林夏", documentId: currentDocument.id, id: "version-current", title: "当前标题" },
            { createdAt: 1000, createdBy: "林夏", documentId: currentDocument.id, id: "version-old", title: "历史标题" },
          ],
        }), { status: 200 }));
      }

      return Promise.resolve(new Response(null, { status: 404 }));
    }));

    await renderEditor({ workspace: databaseWorkspace });
    await user.click(screen.getByRole("button", { name: "历史" }));
    await user.click(await screen.findByRole("button", { name: "恢复版本 历史标题" }));

    expect(screen.getByLabelText("文档标题")).toHaveValue("历史标题");
    expect(screen.getAllByLabelText("块内容")[0]).toHaveTextContent("历史正文");
  });

  it("shows a document outline from the title and heading blocks", async () => {
    const user = userEvent.setup();
    await renderEditor();
    await createBlankDocument(user);

    await user.clear(screen.getByLabelText("文档标题"));
    await user.type(screen.getByLabelText("文档标题"), "产品路线图");

    const firstEditor = await screen.findByTestId(/^block-editor-/);
    await user.click(firstEditor);
    await user.keyboard("本周目标");
    await user.click(screen.getByLabelText("打开块菜单"));
    await user.click(screen.getByRole("menuitem", { name: "转为标题" }));

    const contextPanel = screen.getByRole("complementary", { name: "文档侧栏" });

    expect(within(contextPanel).getByText("文档大纲")).toBeInTheDocument();
    expect(within(contextPanel).getByRole("button", { name: "产品路线图" })).toBeInTheDocument();
    expect(within(contextPanel).getByRole("button", { name: "本周目标" })).toBeInTheDocument();
  });

  it("shows todo progress in the document context panel", async () => {
    const user = userEvent.setup();
    await renderEditor();
    await createBlankDocument(user);

    await user.click(screen.getByLabelText("打开块菜单"));
    await user.click(screen.getByRole("menuitem", { name: "转为待办" }));
    await user.type(screen.getByLabelText("待办内容"), "确认上线窗口");
    await user.click(screen.getByLabelText("在下方添加块"));

    const rows = await getRows();
    await user.click(within(rows[1]).getByLabelText("打开块菜单"));
    await user.click(screen.getByRole("menuitem", { name: "转为待办" }));
    await user.type(screen.getAllByLabelText("待办内容")[1], "同步评审结论");
    await user.click(screen.getAllByRole("checkbox", { name: "待办完成状态" })[0]);

    const contextPanel = screen.getByRole("complementary", { name: "文档侧栏" });

    expect(within(contextPanel).getByText("待办进度")).toBeInTheDocument();
    expect(within(contextPanel).getByText("1 / 2")).toBeInTheDocument();
    expect(within(contextPanel).getByText("50%")).toBeInTheDocument();
  });

  it("updates block status, assignee, and due date from the collaboration popover", async () => {
    const user = userEvent.setup();
    await renderEditor();

    const taskInput = screen.getByDisplayValue("确认核心场景");
    const taskRow = taskInput.closest("article");

    expect(taskRow).not.toBeNull();
    await user.click(within(taskRow as HTMLElement).getByLabelText("打开块协作属性"));
    const popover = screen.getByRole("dialog", { name: "块协作属性" });

    await user.click(within(popover).getByRole("button", { name: "待评审" }));
    await user.clear(within(popover).getByLabelText("负责人"));
    await user.type(within(popover).getByLabelText("负责人"), "周宁");
    await user.click(within(popover).getByRole("button", { name: "明天" }));

    expect(within(taskRow as HTMLElement).getByText("周宁")).toBeInTheDocument();
    expect(within(taskRow as HTMLElement).getAllByText("明天").length).toBeGreaterThan(0);
    expect(within(taskRow as HTMLElement).getAllByText("待评审").length).toBeGreaterThan(0);
    expect(within(screen.getByRole("complementary", { name: "文档侧栏" })).getAllByText("周宁").length).toBeGreaterThan(0);
  });

  it("opens a member panel with collaborator workload and activity", async () => {
    const user = userEvent.setup();
    await renderEditor();

    await user.click(screen.getByRole("button", { name: "成员 3" }));
    const memberPanel = screen.getByRole("dialog", { name: "成员与协作" });

    expect(within(memberPanel).getByText("在线成员")).toBeInTheDocument();
    expect(within(memberPanel).getByRole("button", { name: "查看成员 林夏 内容参与者" })).toHaveTextContent("2 个任务");
    expect(within(memberPanel).getAllByText("未在线").length).toBeGreaterThan(0);
    expect(within(memberPanel).getAllByText("正在编辑 需求 PRD").length).toBeGreaterThan(0);
    expect(within(memberPanel).getByText("1 条待处理评论")).toBeInTheDocument();
  });

  it("edits the document title and mirrors it in navigation", async () => {
    const user = userEvent.setup();
    await renderEditor();

    const titleInput = screen.getByLabelText("文档标题");
    await user.clear(titleInput);
    await user.type(titleInput, "产品路线图");

    expect(titleInput).toHaveValue("产品路线图");
    expect(within((await getDocumentButtons())[0]).getByText("产品路线图")).toBeInTheDocument();
  });

  it("shows unnamed fallback in navigation when the title is empty", async () => {
    const user = userEvent.setup();
    await renderEditor();

    const titleInput = screen.getByLabelText("文档标题");
    await user.clear(titleInput);

    expect(titleInput).toHaveValue("");
    await waitFor(async () => {
      expect(within((await getDocumentButtons())[0]).getByText("未命名文档")).toBeInTheDocument();
    });
  });

  it("duplicates a document from the document action menu", async () => {
    const user = userEvent.setup();
    await renderEditor();
    await createBlankDocument(user);

    await user.click(screen.getByLabelText("打开文档操作 未命名文档"));
    await user.click(screen.getByRole("menuitem", { name: "复制文档" }));

    await waitFor(async () => expect(await getDocumentButtons()).toHaveLength(6));
    const documentButtons = await getDocumentButtons();
    expect(documentButtons.some((button) => button.getAttribute("aria-current") === "page")).toBe(true);
    expect(screen.getByLabelText("文档标题")).toHaveValue("未命名文档 副本");
  });

  it("deletes a newly created document from the document action menu after confirmation", async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    await renderEditor();

    await createBlankDocument(user);
    await waitFor(async () => expect(await getDocumentButtons()).toHaveLength(5));

    const actionButtons = screen.getAllByLabelText("打开文档操作 未命名文档");
    await user.click(actionButtons[actionButtons.length - 1]);
    await user.click(screen.getByRole("menuitem", { name: "删除文档" }));

    await waitFor(async () => expect(await getDocumentButtons()).toHaveLength(4));
    expect(confirmSpy).toHaveBeenCalledWith("确定删除“未命名文档”吗？此操作无法撤销。");
    expect((await getDocumentButtons()).some((button) => button.getAttribute("aria-current") === "page")).toBe(true);
  });

  it("restores a deleted document from the undo toast", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    await renderEditor();

    await createBlankDocument(user);
    await user.clear(screen.getByLabelText("文档标题"));
    await user.type(screen.getByLabelText("文档标题"), "客户复盘");
    await waitFor(async () => expect(await getDocumentButtons()).toHaveLength(5));

    await user.click(screen.getByLabelText("打开文档操作 客户复盘"));
    await user.click(screen.getByRole("menuitem", { name: "删除文档" }));

    expect(screen.getByRole("status")).toHaveTextContent("已删除“客户复盘”");
    expect(await getDocumentButtons()).toHaveLength(4);

    await user.click(screen.getByRole("button", { name: "撤销删除" }));

    await waitFor(async () => expect(await getDocumentButtons()).toHaveLength(5));
    expect(screen.getByLabelText("文档标题")).toHaveValue("客户复盘");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("switches documents without leaking edited content", async () => {
    const user = userEvent.setup();
    await renderEditor();
    await createBlankDocument(user);
    const firstBlankNavId = (await getDocumentButtons())
      .find((button) => button.getAttribute("aria-current") === "page")
      ?.getAttribute("data-testid");

    const firstEditor = await screen.findByTestId(/^block-editor-/);
    await user.click(firstEditor);
    await user.keyboard("第一个文档");
    await waitFor(() => expect(firstEditor).toHaveTextContent("第一个文档"));

    await createBlankDocument(user);
    const secondEditor = await screen.findByTestId(/^block-editor-/);
    expect(secondEditor).not.toHaveTextContent("第一个文档");

    const documentButtons = await getDocumentButtons();
    const firstBlankButton = documentButtons.find((button) => button.getAttribute("data-testid") === firstBlankNavId);

    await user.click(firstBlankButton!);

    await waitFor(() => expect(screen.getByTestId(/^block-editor-/)).toHaveTextContent("第一个文档"));
  });

  it("focuses the next block after pressing Enter", async () => {
    const user = userEvent.setup();
    await renderEditor();
    await createBlankDocument(user);

    const firstEditor = await screen.findByTestId(/^block-editor-/);
    await user.click(firstEditor);
    await user.keyboard("第一块{Enter}");

    await waitFor(async () => {
      const editors = await screen.findAllByTestId(/^block-editor-/);
      expect(editors[1]).toHaveFocus();
    });
    await user.keyboard("第二块");

    const rows = await getRows();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("第一块");
    expect(rows[1]).toHaveTextContent("第二块");
  });

  it("focuses the next block after clicking add block", async () => {
    const user = userEvent.setup();
    await renderEditor();
    await createBlankDocument(user);

    const firstEditor = await screen.findByTestId(/^block-editor-/);
    await user.click(firstEditor);
    await user.keyboard("第一块");
    await user.click(screen.getByLabelText("在下方添加块"));
    await waitFor(async () => {
      const editors = await screen.findAllByTestId(/^block-editor-/);
      expect(editors[1]).toHaveFocus();
    });
    await user.keyboard("第二块");

    const rows = await getRows();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("第一块");
    expect(rows[1]).toHaveTextContent("第二块");
  });

  it("adds and deletes blocks while preserving one block", async () => {
    const user = userEvent.setup();
    await renderEditor();
    await createBlankDocument(user);

    await user.click(screen.getByLabelText("在下方添加块"));
    expect(await getRows()).toHaveLength(2);

    const rowsAfterAdd = await getRows();
    await user.click(within(rowsAfterAdd[1]).getByLabelText("打开块菜单"));
    await user.click(screen.getByRole("menuitem", { name: "删除块" }));
    expect(await getRows()).toHaveLength(1);

    const remainingRow = (await getRows())[0];
    await user.click(within(remainingRow).getByLabelText("打开块菜单"));
    await user.click(screen.getByRole("menuitem", { name: "删除块" }));
    expect(await getRows()).toHaveLength(1);
  });

  it("restores a deleted content block from the undo toast", async () => {
    const user = userEvent.setup();
    await renderEditor();
    await createBlankDocument(user);

    const firstEditor = await screen.findByTestId(/^block-editor-/);
    await user.click(firstEditor);
    await user.keyboard("第一段内容");
    await user.click(screen.getByLabelText("在下方添加块"));

    const rows = await getRows();
    const secondEditor = within(rows[1]).getByTestId(/^block-editor-/);
    await user.click(secondEditor);
    await user.keyboard("需要恢复的块");
    await user.click(within(rows[1]).getByLabelText("打开块菜单"));
    await user.click(screen.getByRole("menuitem", { name: "删除块" }));

    expect(screen.getByRole("status")).toHaveTextContent("已删除块“需要恢复的块”");
    expect(await getRows()).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "撤销删除" }));

    await waitFor(async () => expect(await getRows()).toHaveLength(2));
    expect(screen.getByText("需要恢复的块")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("changes a block to todo from the block menu and toggles it", async () => {
    const user = userEvent.setup();
    await renderEditor();
    await createBlankDocument(user);

    await user.click(screen.getByLabelText("打开块菜单"));
    await user.click(screen.getByRole("menuitem", { name: "转为待办" }));
    const checkbox = await screen.findByRole("checkbox", { name: "待办完成状态" });

    await user.click(checkbox);

    expect(checkbox).toBeChecked();
  });

  it("opens an insert menu with slash and changes the focused block", async () => {
    const user = userEvent.setup();
    await renderEditor();
    await createBlankDocument(user);

    const editor = await screen.findByTestId(/^block-editor-/);
    await user.click(editor);
    await user.keyboard("/");

    expect(screen.getByRole("menu", { name: "插入菜单" })).toBeInTheDocument();
    await user.click(screen.getByRole("menuitem", { name: "标题" }));

    expect((await getRows())[0]).toHaveClass("block-row-heading");
    expect(editor).not.toHaveTextContent("/");
  });

  it("changes a block to an image and stores the uploaded attachment", async () => {
    const user = userEvent.setup();
    await renderEditor();
    await createBlankDocument(user);
    const editor = await screen.findByTestId(/^block-editor-/);
    await user.click(editor);
    await user.keyboard("/");

    await user.click(screen.getByRole("menuitem", { name: "图片" }));
    const uploadInput = await screen.findByLabelText("上传图片");
    const file = new File(["image"], "设计稿.png", { type: "image/png" });
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string) => {
      if (url === "/api/files") {
        return Promise.resolve(new Response(JSON.stringify({
          attachment: {
            key: "local/object-1.png",
            kind: "image",
            mimeType: "image/png",
            name: "设计稿.png",
            size: 5,
            url: "/api/files/local/object-1.png",
          },
        }), { status: 201 }));
      }

      return Promise.resolve(new Response(JSON.stringify({ saved: true }), { status: 200 }));
    }));
    await user.upload(uploadInput, file);

    expect(await screen.findByRole("img", { name: "设计稿.png" })).toHaveAttribute(
      "src",
      "/api/files/local/object-1.png",
    );
  });

  it("creates and edits table and kanban blocks from the slash menu", async () => {
    const user = userEvent.setup();
    await renderEditor();
    await createBlankDocument(user);

    const editor = await screen.findByTestId(/^block-editor-/);
    await user.click(editor);
    await user.keyboard("/");
    await user.click(screen.getByRole("menuitem", { name: "表格" }));

    const table = await screen.findByRole("table", { name: "表格块" });
    const nameCell = within(table).getByLabelText("单元格 空白 名称");
    await user.type(nameCell, "产品路线图");
    expect(nameCell).toHaveValue("产品路线图");

    await user.click(within((await getRows())[0]).getByLabelText("在下方添加块"));
    const nextEditor = await screen.findByTestId(/^block-editor-/);
    await user.click(nextEditor);
    await user.keyboard("/");
    await user.click(screen.getByRole("menuitem", { name: "看板" }));

    await user.click(screen.getByRole("button", { name: "在待处理中添加卡片" }));
    expect(await screen.findByDisplayValue("新卡片")).toBeInTheDocument();
  });

  it("opens the slash menu when slash is inserted as editor content", async () => {
    const user = userEvent.setup();
    await renderEditor();
    await createBlankDocument(user);

    const editor = await screen.findByTestId(/^block-editor-/);
    await user.click(editor);
    await user.type(editor, "/");

    expect(screen.getByRole("menu", { name: "插入菜单" })).toBeInTheDocument();
    expect(editor).not.toHaveTextContent("/");
  });

  it("selects a slash menu command with keyboard navigation", async () => {
    const user = userEvent.setup();
    await renderEditor();
    await createBlankDocument(user);

    const editor = await screen.findByTestId(/^block-editor-/);
    await user.click(editor);
    await user.keyboard("/");

    expect(screen.getByRole("menu", { name: "插入菜单" })).toBeInTheDocument();
    await user.keyboard("{ArrowDown}{Enter}");

    expect((await getRows())[0]).toHaveClass("block-row-heading");
    expect(screen.queryByRole("menu", { name: "插入菜单" })).not.toBeInTheDocument();
  });

  it("turns markdown shortcuts into block types without keeping the trigger text", async () => {
    const user = userEvent.setup();
    await renderEditor();
    await createBlankDocument(user);

    const firstEditor = await screen.findByTestId(/^block-editor-/);
    await user.click(firstEditor);
    await user.keyboard("# ");
    expect((await getRows())[0]).toHaveClass("block-row-heading");
    expect(firstEditor).not.toHaveTextContent("#");

    await user.click(screen.getByLabelText("在下方添加块"));
    const quoteRow = (await getRows())[1];
    const quoteEditor = within(quoteRow).getByTestId(/^block-editor-/);
    await user.click(quoteEditor);
    await user.keyboard("> ");
    expect((await getRows())[1]).toHaveClass("block-row-quote");
    expect(quoteEditor).not.toHaveTextContent(">");

    await user.click(screen.getAllByLabelText("在下方添加块")[1]);
    const todoRow = (await getRows())[2];
    const todoEditor = within(todoRow).getByTestId(/^block-editor-/);
    await user.click(todoEditor);
    await user.keyboard("[[] ");
    expect((await getRows())[2]).toHaveClass("block-row-todo");
    expect(screen.getByLabelText("待办内容")).toHaveValue("");

    await user.click(screen.getAllByLabelText("在下方添加块")[2]);
    const codeRow = (await getRows())[3];
    const codeEditor = within(codeRow).getByTestId(/^block-editor-/);
    await user.click(codeEditor);
    await user.keyboard("``` ");
    expect((await getRows())[3]).toHaveClass("block-row-code");
    expect(screen.getByText("代码片段")).toBeInTheDocument();
    expect(codeEditor).not.toHaveTextContent("```");
  });

  it("inserts quote and code blocks from the slash menu", async () => {
    const user = userEvent.setup();
    await renderEditor();
    await createBlankDocument(user);

    const editor = await screen.findByTestId(/^block-editor-/);
    await user.click(editor);
    await user.keyboard("/");
    await user.click(screen.getByRole("menuitem", { name: "引用" }));
    expect((await getRows())[0]).toHaveClass("block-row-quote");

    await user.click(screen.getByLabelText("在下方添加块"));
    const rows = await getRows();
    const secondEditor = within(rows[1]).getByTestId(/^block-editor-/);
    await user.click(secondEditor);
    await user.keyboard("/");
    await user.click(screen.getByRole("menuitem", { name: "代码" }));

    expect((await getRows())[1]).toHaveClass("block-row-code");
    expect(screen.getByText("代码片段")).toBeInTheDocument();
  });

  it("moves blocks up and down", async () => {
    const user = userEvent.setup();
    await renderEditor();
    await createBlankDocument(user);

    await user.click(screen.getByLabelText("在下方添加块"));
    const originalRows = await getRows();
    const firstId = originalRows[0].getAttribute("data-testid");
    const secondId = originalRows[1].getAttribute("data-testid");

    await user.click(within(originalRows[1]).getByLabelText("打开块菜单"));
    await user.click(screen.getByRole("menuitem", { name: "上移块" }));
    const movedUpRows = await getRows();
    expect(movedUpRows[0]).toHaveAttribute("data-testid", secondId);
    expect(movedUpRows[1]).toHaveAttribute("data-testid", firstId);

    await user.click(within(movedUpRows[0]).getByLabelText("打开块菜单"));
    await user.click(screen.getByRole("menuitem", { name: "下移块" }));
    const movedDownRows = await getRows();
    expect(movedDownRows[0]).toHaveAttribute("data-testid", firstId);
    expect(movedDownRows[1]).toHaveAttribute("data-testid", secondId);
  });

  it("indents and outdents blocks from the block menu", async () => {
    const user = userEvent.setup();
    await renderEditor();
    await createBlankDocument(user);
    await user.click(screen.getByLabelText("在下方添加块"));

    const rows = await getRows();
    await user.click(within(rows[1]).getByLabelText("打开块菜单"));
    await user.click(screen.getByRole("menuitem", { name: "缩进块" }));

    expect((await getRows())[1]).toHaveAttribute("data-block-depth", "1");

    await user.click(within((await getRows())[1]).getByLabelText("打开块菜单"));
    await user.click(screen.getByRole("menuitem", { name: "取消缩进" }));

    expect((await getRows())[1]).toHaveAttribute("data-block-depth", "0");
  });
});
