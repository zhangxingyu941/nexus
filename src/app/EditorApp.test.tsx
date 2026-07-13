import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EditorApp } from "./EditorApp";

vi.mock("../features/editor/components/EditorPage", () => ({
  EditorPage: ({
    onSignOut,
    sessionUser,
  }: {
    onSignOut?: () => void;
    sessionUser?: { displayName: string } | null;
  }) => (
    <main aria-label="Next 编辑器入口">
      编辑器已加载
      {sessionUser ? <span>{sessionUser.displayName}</span> : null}
      {onSignOut ? <button onClick={onSignOut}>退出测试用户</button> : null}
    </main>
  ),
}));

describe("EditorApp", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("enters the editor directly in local mode", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ mode: "local", user: null })));

    render(<EditorApp />);

    expect(await screen.findByLabelText("Next 编辑器入口")).toHaveTextContent("编辑器已加载");
    expect(screen.queryByLabelText("密码")).not.toBeInTheDocument();
  });

  it("shows password login when database mode has no session and signs in", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: "请先进入工作区" }, 401))
      .mockResolvedValueOnce(jsonResponse({ github: false }))
      .mockResolvedValueOnce(
        jsonResponse(
          {
            mode: "database",
            user: { displayName: "林夏", email: "linxia@example.com", id: "user-1" },
          },
          200,
        ),
      );
    vi.stubGlobal("fetch", fetchSpy);

    render(<EditorApp />);

    expect(await screen.findByRole("heading", { name: "Nexus 工作区" })).toBeInTheDocument();
    expect(screen.getByText("把文档、任务和协作放在同一条工作流里。"))
      .toBeInTheDocument();
    await user.type(await screen.findByLabelText("邮箱"), "linxia@example.com");
    await user.type(screen.getByLabelText("密码"), "correct horse battery staple");
    await user.click(screen.getByRole("button", { name: "登录" }));

    expect(await screen.findByLabelText("Next 编辑器入口")).toHaveTextContent("林夏");
    expect(fetchSpy).toHaveBeenLastCalledWith(
      "/api/auth/session",
      expect.objectContaining({
        body: JSON.stringify({ email: "linxia@example.com", password: "correct horse battery staple" }),
        method: "POST",
      }),
    );
  });

  it("registers with an email code and enters the editor after verification", async () => {
    const user = userEvent.setup();
    const registeredUser = { displayName: "林夏", email: "linxia@example.com", id: "user-1" };
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: "请先进入工作区" }, 401))
      .mockResolvedValueOnce(jsonResponse({ github: false }))
      .mockResolvedValueOnce(jsonResponse({ registered: true, retryAfterSeconds: 60 }, 201))
      .mockResolvedValueOnce(jsonResponse({ user: registeredUser, verified: true }));
    vi.stubGlobal("fetch", fetchSpy);

    render(<EditorApp />);
    await user.click(await screen.findByRole("tab", { name: "注册" }));
    await user.type(screen.getByLabelText("姓名"), "林夏");
    await user.type(screen.getByLabelText("邮箱"), "linxia@example.com");
    await user.type(screen.getByLabelText("密码"), "correct horse battery staple");
    await user.click(screen.getByRole("button", { name: "创建账号" }));

    expect(await screen.findByText("验证码已发送至 linxia@example.com")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重新发送（60s）" })).toBeDisabled();
    await user.type(screen.getByLabelText("邮箱验证码"), "123456");
    await user.click(screen.getByRole("button", { name: "验证并进入工作区" }));

    expect(await screen.findByLabelText("Next 编辑器入口")).toHaveTextContent("林夏");
    expect(fetchSpy).toHaveBeenNthCalledWith(
      3,
      "/api/auth/register",
      expect.objectContaining({
        body: JSON.stringify({
          displayName: "林夏",
          email: "linxia@example.com",
          password: "correct horse battery staple",
        }),
      }),
    );
    expect(fetchSpy).toHaveBeenLastCalledWith(
      "/api/auth/verify-email",
      expect.objectContaining({
        body: JSON.stringify({ code: "123456", email: "linxia@example.com" }),
      }),
    );
  });

  it("counts down registration resend and applies the server retry time", async () => {
    vi.useFakeTimers();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: "请先进入工作区" }, 401))
      .mockResolvedValueOnce(jsonResponse({ github: false }))
      .mockResolvedValueOnce(jsonResponse({ registered: true, retryAfterSeconds: 60 }, 201))
      .mockResolvedValueOnce(jsonResponse({
        error: "请在 37 秒后重新发送验证码",
        retryAfterSeconds: 37,
      }, 429));
    vi.stubGlobal("fetch", fetchSpy);

    render(<EditorApp />);
    await user.click(await screen.findByRole("tab", { name: "注册" }));
    await user.type(screen.getByLabelText("姓名"), "林夏");
    await user.type(screen.getByLabelText("邮箱"), "linxia@example.com");
    await user.type(screen.getByLabelText("密码"), "correct horse battery staple");
    await user.click(screen.getByRole("button", { name: "创建账号" }));

    expect(await screen.findByRole("button", { name: "重新发送（60s）" })).toBeDisabled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(screen.getByRole("button", { name: "重新发送（59s）" })).toBeDisabled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(59_000);
    });
    const resend = screen.getByRole("button", { name: "重新发送验证码" });
    expect(resend).toBeEnabled();

    await user.click(resend);
    expect(await screen.findByRole("alert")).toHaveTextContent("请在 37 秒后重新发送验证码");
    expect(screen.getByRole("button", { name: "重新发送（37s）" })).toBeDisabled();
  });

  it("resets a password with an email code and enters the editor", async () => {
    const user = userEvent.setup();
    const resetUser = { displayName: "旧账号", email: "legacy@example.com", id: "user-legacy" };
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: "请先进入工作区" }, 401))
      .mockResolvedValueOnce(jsonResponse({ github: false }))
      .mockResolvedValueOnce(jsonResponse({ accepted: true, retryAfterSeconds: 60 }, 202))
      .mockResolvedValueOnce(jsonResponse({ reset: true, user: resetUser }));
    vi.stubGlobal("fetch", fetchSpy);

    render(<EditorApp />);
    await user.click(await screen.findByRole("button", { name: "忘记密码" }));
    await user.type(screen.getByLabelText("邮箱"), "legacy@example.com");
    await user.click(screen.getByRole("button", { name: "发送验证码" }));

    expect(await screen.findByText("如果账号存在，验证码已发送")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重新发送（60s）" })).toBeDisabled();
    await user.type(screen.getByLabelText("邮箱验证码"), "654321");
    await user.type(screen.getByLabelText("新密码"), "replacement secure password");
    await user.click(screen.getByRole("button", { name: "重置密码并进入工作区" }));

    expect(await screen.findByLabelText("Next 编辑器入口")).toHaveTextContent("旧账号");
    expect(fetchSpy).toHaveBeenLastCalledWith(
      "/api/auth/password/reset",
      expect.objectContaining({
        body: JSON.stringify({
          code: "654321",
          email: "legacy@example.com",
          password: "replacement secure password",
        }),
      }),
    );
  });

  it("shows GitHub login only when configured", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(jsonResponse({ error: "请先进入工作区" }, 401))
      .mockResolvedValueOnce(jsonResponse({ github: true })));

    render(<EditorApp />);

    expect(await screen.findByRole("link", { name: "使用 GitHub 登录" })).toHaveAttribute(
      "href",
      "/api/auth/oauth/github",
    );
  });

  it("announces the workspace loading state", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => undefined)));

    render(<EditorApp />);

    expect(screen.getByRole("status", { name: "正在加载工作区" })).toBeInTheDocument();
  });

  it("restores an existing database session", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          mode: "database",
          user: { displayName: "周宁", email: "zhouning@example.com", id: "user-2" },
        }),
      ),
    );

    render(<EditorApp />);

    expect(await screen.findByLabelText("Next 编辑器入口")).toHaveTextContent("周宁");
  });

  it("revokes the database session and returns to the identity form", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          mode: "database",
          user: { displayName: "林夏", email: "linxia@example.com", id: "user-1" },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    fetchSpy.mockResolvedValueOnce(jsonResponse({ github: false }));
    vi.stubGlobal("fetch", fetchSpy);

    render(<EditorApp />);
    await user.click(await screen.findByRole("button", { name: "退出测试用户" }));

    expect(await screen.findByLabelText("密码")).toBeInTheDocument();
    await waitFor(() =>
      expect(fetchSpy).toHaveBeenCalledWith(
        "/api/auth/session",
        expect.objectContaining({ method: "DELETE" }),
      ),
    );
  });
});

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}
