import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearDocument, clearWorkspace } from "../persistence/editorRepository";
import { EditorPage } from "./EditorPage";

async function renderEditor() {
  render(<EditorPage />);
  await screen.findByRole("heading", { name: "未命名文档" });
}

async function getRows() {
  return screen.findAllByTestId(/^block-row-/);
}

async function getDocumentButtons() {
  return screen.findAllByTestId(/^document-nav-/);
}

describe("EditorPage", () => {
  beforeEach(async () => {
    await clearWorkspace();
    await clearDocument();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders a collaborative workspace shell with an editable document", async () => {
    await renderEditor();

    expect(within(screen.getByLabelText("工作区页面")).getByText("团队知识库")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "新建文档" })).toBeInTheDocument();
    expect(screen.getByText("项目空间")).toBeInTheDocument();
    expect(screen.getByLabelText("协作操作")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "评论 3" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "分享" })).toBeInTheDocument();
    expect(screen.getByLabelText("文档编辑区")).toBeInTheDocument();
    expect(await getRows()).toHaveLength(1);
    expect(screen.queryByLabelText("块类型")).not.toBeInTheDocument();
    expect(screen.getByLabelText("打开块菜单")).toBeInTheDocument();
  });

  it("creates a new document and switches to it", async () => {
    const user = userEvent.setup();
    await renderEditor();

    await user.click(screen.getByRole("button", { name: "新建文档" }));

    await waitFor(async () => expect(await getDocumentButtons()).toHaveLength(2));
    const documentButtons = await getDocumentButtons();
    expect(documentButtons[1]).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("heading", { name: "未命名文档" })).toBeInTheDocument();
  });

  it("deletes a newly created document after confirmation", async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    await renderEditor();

    await user.click(screen.getByRole("button", { name: "新建文档" }));
    await waitFor(async () => expect(await getDocumentButtons()).toHaveLength(2));

    const deleteButtons = screen.getAllByLabelText("删除文档 未命名文档");
    await user.click(deleteButtons[1]);

    await waitFor(async () => expect(await getDocumentButtons()).toHaveLength(1));
    expect(confirmSpy).toHaveBeenCalledWith("确定删除“未命名文档”吗？此操作无法撤销。");
    expect((await getDocumentButtons())[0]).toHaveAttribute("aria-current", "page");
  });

  it("switches documents without leaking edited content", async () => {
    const user = userEvent.setup();
    await renderEditor();

    const firstEditor = await screen.findByTestId(/^block-editor-/);
    await user.click(firstEditor);
    await user.keyboard("第一个文档");
    await waitFor(() => expect(firstEditor).toHaveTextContent("第一个文档"));

    await user.click(screen.getByRole("button", { name: "新建文档" }));
    const secondEditor = await screen.findByTestId(/^block-editor-/);
    expect(secondEditor).not.toHaveTextContent("第一个文档");

    const documentButtons = await getDocumentButtons();
    await user.click(documentButtons[0]);

    await waitFor(() => expect(screen.getByTestId(/^block-editor-/)).toHaveTextContent("第一个文档"));
  });

  it("adds and deletes blocks while preserving one block", async () => {
    const user = userEvent.setup();
    await renderEditor();

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

  it("changes a block to todo from the block menu and toggles it", async () => {
    const user = userEvent.setup();
    await renderEditor();

    await user.click(screen.getByLabelText("打开块菜单"));
    await user.click(screen.getByRole("menuitem", { name: "转为待办" }));
    const checkbox = await screen.findByRole("checkbox", { name: "待办完成状态" });

    await user.click(checkbox);

    expect(checkbox).toBeChecked();
  });

  it("opens an insert menu with slash and changes the focused block", async () => {
    const user = userEvent.setup();
    await renderEditor();

    const editor = await screen.findByTestId(/^block-editor-/);
    await user.click(editor);
    await user.keyboard("/");

    expect(screen.getByRole("menu", { name: "插入菜单" })).toBeInTheDocument();
    await user.click(screen.getByRole("menuitem", { name: "标题" }));

    expect((await getRows())[0]).toHaveClass("block-row-heading");
    expect(editor).not.toHaveTextContent("/");
  });

  it("moves blocks up and down", async () => {
    const user = userEvent.setup();
    await renderEditor();

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
});
