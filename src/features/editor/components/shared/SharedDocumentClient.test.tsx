import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SharedDocumentClient } from "./SharedDocumentClient";

const snapshot = {
  document: {
    blocks: [{
      children: [],
      content: "公开正文",
      data: null,
      headingLevel: 1 as const,
      id: "block-1",
      parentId: null,
      type: "paragraph" as const,
    }],
    title: "公开方案",
  },
  expiresAt: Date.UTC(2026, 6, 22, 12, 0, 0),
};

describe("SharedDocumentClient", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders a shared document without workspace or editing controls", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(jsonResponse(snapshot));
    vi.stubGlobal("fetch", fetchSpy);

    render(<SharedDocumentClient token="raw/token" />);

    expect(screen.getByRole("status")).toHaveTextContent("正在加载分享文档");
    expect(await screen.findByRole("heading", { name: "公开方案" })).toBeInTheDocument();
    expect(screen.getByText("公开正文")).toBeInTheDocument();
    expect(screen.getByText("Nexus")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "分享" })).not.toBeInTheDocument();
    expect(screen.queryByRole("toolbar", { name: "当前块操作" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "打开块评论" })).not.toBeInTheDocument();
    expect(screen.queryByText("协同已连接")).not.toBeInTheDocument();
    expect(screen.queryByText("插入标题、待办、引用或协作评论")).not.toBeInTheDocument();
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/shared-documents/raw%2Ftoken",
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  it.each([
    [404, "分享链接不存在"],
    [410, "分享链接已失效"],
  ])("renders a private unavailable state for status %s", async (status, message) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ error: message }, status)));

    render(<SharedDocumentClient token="raw-token" />);

    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(screen.queryByText("公开方案")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "重新加载" })).not.toBeInTheDocument();
  });

  it("retries a temporary service failure", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.fn()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(jsonResponse(snapshot));
    vi.stubGlobal("fetch", fetchSpy);

    render(<SharedDocumentClient token="raw-token" />);

    await user.click(await screen.findByRole("button", { name: "重新加载" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "公开方案" }))
      .toBeInTheDocument());
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}
