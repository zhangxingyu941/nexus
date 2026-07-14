import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AttachmentBlockEditor } from "./AttachmentBlockEditor";

const attachmentRepositoryMock = vi.hoisted(() => ({
  uploadAttachment: vi.fn(),
}));

vi.mock("../../persistence/attachmentRepository", () => attachmentRepositoryMock);

describe("AttachmentBlockEditor", () => {
  beforeEach(() => {
    attachmentRepositoryMock.uploadAttachment.mockReset();
  });

  it("uploads an image and returns its structured data", async () => {
    const user = userEvent.setup();
    const file = new File(["image"], "设计稿.png", { type: "image/png" });
    const attachment = {
      key: "local/object-1.png",
      kind: "image" as const,
      mimeType: "image/png",
      name: "设计稿.png",
      size: 5,
      url: "/api/files/local/object-1.png",
    };
    const onChangeData = vi.fn();
    attachmentRepositoryMock.uploadAttachment.mockResolvedValue(attachment);

    render(
      <AttachmentBlockEditor
        content=""
        data={null}
        isReadOnly={false}
        kind="image"
        onChangeContent={() => undefined}
        onChangeData={onChangeData}
      />,
    );

    await user.upload(screen.getByLabelText("上传图片"), file);

    expect(attachmentRepositoryMock.uploadAttachment).toHaveBeenCalledWith(file, "image");
    await waitFor(() => expect(onChangeData).toHaveBeenCalledWith(attachment));
  });

  it("renders stored files and removes them only in edit mode", async () => {
    const user = userEvent.setup();
    const onChangeData = vi.fn();
    const data = {
      key: "local/object-1.pdf",
      kind: "file" as const,
      mimeType: "application/pdf",
      name: "需求方案.pdf",
      size: 1024,
      url: "/api/files/local/object-1.pdf",
    };
    const { rerender } = render(
      <AttachmentBlockEditor
        content="文件说明"
        data={data}
        isReadOnly={false}
        kind="file"
        onChangeContent={() => undefined}
        onChangeData={onChangeData}
      />,
    );

    expect(screen.getByRole("link", { name: "打开文件 需求方案.pdf" })).toHaveAttribute("href", data.url);
    await user.click(screen.getByRole("button", { name: "移除文件 需求方案.pdf" }));
    expect(onChangeData).toHaveBeenCalledWith(null);

    rerender(
      <AttachmentBlockEditor
        content="文件说明"
        data={data}
        isReadOnly
        kind="file"
        onChangeContent={() => undefined}
        onChangeData={onChangeData}
      />,
    );
    expect(screen.queryByRole("button", { name: "移除文件 需求方案.pdf" })).not.toBeInTheDocument();
  });
});
