import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultWorkspace } from "../../model/workspaceOperations";
import { HistoryPanel } from "./HistoryPanel";

const historyRepositoryMock = vi.hoisted(() => ({
  loadDocumentVersions: vi.fn(),
  restoreDocumentVersion: vi.fn(),
}));

vi.mock("../../persistence/documentHistoryRepository", () => historyRepositoryMock);

describe("HistoryPanel", () => {
  beforeEach(() => {
    historyRepositoryMock.loadDocumentVersions.mockReset();
    historyRepositoryMock.restoreDocumentVersion.mockReset();
  });

  it("loads database versions and restores the selected snapshot", async () => {
    const user = userEvent.setup();
    const restoredDocument = createDefaultWorkspace(1000).documents[0];
    const onRestoreDocument = vi.fn();
    historyRepositoryMock.loadDocumentVersions.mockResolvedValue([
      {
        createdAt: 3000,
        createdBy: "林夏",
        documentId: restoredDocument.id,
        id: "version-3",
        title: "当前版本",
      },
      {
        createdAt: 2000,
        createdBy: "林夏",
        documentId: restoredDocument.id,
        id: "version-2",
        title: "第二版",
      },
    ]);
    historyRepositoryMock.restoreDocumentVersion.mockResolvedValue(restoredDocument);

    render(
      <HistoryPanel
        activities={[]}
        documentId={restoredDocument.id}
        isReadOnly={false}
        onClose={() => undefined}
        onRestoreDocument={onRestoreDocument}
        workspaceId="workspace-a"
      />,
    );

    expect(await screen.findByText("第二版")).toBeInTheDocument();
    expect(screen.getAllByText(/林夏/)).toHaveLength(2);

    await user.click(screen.getByRole("button", { name: "恢复版本 第二版" }));

    expect(historyRepositoryMock.restoreDocumentVersion).toHaveBeenCalledWith(
      "workspace-a",
      restoredDocument.id,
      "version-2",
    );
    expect(onRestoreDocument).toHaveBeenCalledWith(restoredDocument);
    expect(screen.getByText("版本已恢复")).toBeInTheDocument();
  });

  it("does not offer restore actions to viewers", async () => {
    historyRepositoryMock.loadDocumentVersions.mockResolvedValue([
      {
        createdAt: 2000,
        createdBy: "林夏",
        documentId: "document-1",
        id: "version-2",
        title: "第二版",
      },
    ]);

    render(
      <HistoryPanel
        activities={[]}
        documentId="document-1"
        isReadOnly
        onClose={() => undefined}
        onRestoreDocument={() => undefined}
        workspaceId="workspace-a"
      />,
    );

    expect(await screen.findByText("第二版")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "恢复版本 第二版" })).not.toBeInTheDocument();
  });
});
