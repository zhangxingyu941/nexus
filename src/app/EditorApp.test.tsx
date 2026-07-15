import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { exportJWK, generateKeyPair } from "jose";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorApp } from "./EditorApp";

let publicJwk: {
  alg: "RSA-OAEP-256";
  e: string;
  kid: string;
  kty: "RSA";
  n: string;
  use: "enc";
};

beforeAll(async () => {
  const { publicKey } = await generateKeyPair("RSA-OAEP-256", { extractable: true });
  const exported = await exportJWK(publicKey);
  if (exported.kty !== "RSA" || !exported.n || !exported.e) {
    throw new Error("Failed to generate the auth test public key");
  }
  publicJwk = {
    alg: "RSA-OAEP-256",
    e: exported.e,
    kid: "editor-app-test-key",
    kty: "RSA",
    n: exported.n,
    use: "enc",
  };
});

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
      .mockResolvedValueOnce(jsonResponse(challengeResponse("login")))
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
    expectChallengeRequest(fetchSpy, 2, "login");
    expectEncryptedRequest(
      fetchSpy,
      3,
      "/api/auth/session",
      { email: "linxia@example.com" },
      ["correct horse battery staple"],
    );
  });

  it("registers with an email code and enters the editor after verification", async () => {
    const user = userEvent.setup();
    const registeredUser = { displayName: "林夏", email: "linxia@example.com", id: "user-1" };
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: "请先进入工作区" }, 401))
      .mockResolvedValueOnce(jsonResponse({ github: false }))
      .mockResolvedValueOnce(jsonResponse(challengeResponse("register")))
      .mockResolvedValueOnce(jsonResponse({ registered: true, retryAfterSeconds: 60 }, 201))
      .mockResolvedValueOnce(jsonResponse(challengeResponse("verify-email")))
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
    expectChallengeRequest(fetchSpy, 2, "register");
    expectEncryptedRequest(
      fetchSpy,
      3,
      "/api/auth/register",
      { displayName: "林夏", email: "linxia@example.com" },
      ["correct horse battery staple"],
    );
    expectChallengeRequest(fetchSpy, 4, "verify-email");
    expectEncryptedRequest(
      fetchSpy,
      5,
      "/api/auth/verify-email",
      { email: "linxia@example.com" },
      ["123456"],
    );
  });

  it("counts down registration resend and applies the server retry time", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: "请先进入工作区" }, 401))
      .mockResolvedValueOnce(jsonResponse({ github: false }))
      .mockResolvedValueOnce(jsonResponse(challengeResponse("register")))
      .mockResolvedValueOnce(jsonResponse({ registered: true, retryAfterSeconds: 1 }, 201))
      .mockResolvedValueOnce(jsonResponse(challengeResponse("register")))
      .mockResolvedValueOnce(jsonResponse({
        codeAvailable: true,
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

    expect(await screen.findByRole("button", { name: "重新发送（1s）" })).toBeDisabled();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "重新发送验证码" })).toBeEnabled();
    }, { timeout: 2_000 });

    await user.click(screen.getByRole("button", { name: "重新发送验证码" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("请在 37 秒后重新发送验证码");
    expect(screen.getByRole("button", { name: "重新发送（37s）" })).toBeDisabled();
    expectChallengeRequest(fetchSpy, 2, "register");
    expectEncryptedRequest(
      fetchSpy,
      3,
      "/api/auth/register",
      { displayName: "林夏", email: "linxia@example.com" },
      ["correct horse battery staple"],
    );
    expectChallengeRequest(fetchSpy, 4, "register");
    expectEncryptedRequest(
      fetchSpy,
      5,
      "/api/auth/register",
      { displayName: "林夏", email: "linxia@example.com" },
      ["correct horse battery staple"],
    );
  });

  it("enters reset-code mode when the first forgot-password request is cooling down", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ error: "请先进入工作区" }, 401))
      .mockResolvedValueOnce(jsonResponse({ github: false }))
      .mockResolvedValueOnce(jsonResponse({
        codeAvailable: true,
        error: "请在 37 秒后重新发送验证码",
        retryAfterSeconds: 37,
      }, 429));
    vi.stubGlobal("fetch", fetchSpy);

    render(<EditorApp />);
    await user.click(await screen.findByRole("button", { name: "忘记密码" }));
    await user.type(screen.getByLabelText("邮箱"), "legacy@example.com");
    await user.click(screen.getByRole("button", { name: "发送验证码" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("请在 37 秒后重新发送验证码");
    expect(screen.getByLabelText("邮箱验证码")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重新发送（37s）" })).toBeDisabled();
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(fetchSpy).toHaveBeenNthCalledWith(
      3,
      "/api/auth/password/forgot",
      expect.objectContaining({
        body: JSON.stringify({ email: "legacy@example.com" }),
        method: "POST",
      }),
    );
  });

  it("resets a password with an email code and enters the editor", async () => {
    const user = userEvent.setup();
    const resetUser = { displayName: "旧账号", email: "legacy@example.com", id: "user-legacy" };
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: "请先进入工作区" }, 401))
      .mockResolvedValueOnce(jsonResponse({ github: false }))
      .mockResolvedValueOnce(jsonResponse({ accepted: true, retryAfterSeconds: 60 }, 202))
      .mockResolvedValueOnce(jsonResponse(challengeResponse("reset-password")))
      .mockResolvedValueOnce(jsonResponse({ reset: true, user: resetUser }));
    vi.stubGlobal("fetch", fetchSpy);

    render(<EditorApp />);
    await user.click(await screen.findByRole("button", { name: "忘记密码" }));
    await user.type(screen.getByLabelText("邮箱"), "legacy@example.com");
    await user.click(screen.getByRole("button", { name: "发送验证码" }));

    expect(await screen.findByText("验证码已发送至 legacy@example.com")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重新发送（60s）" })).toBeDisabled();
    await user.type(screen.getByLabelText("邮箱验证码"), "654321");
    await user.type(screen.getByLabelText("新密码"), "replacement secure password");
    await user.click(screen.getByRole("button", { name: "重置密码并进入工作区" }));

    expect(await screen.findByLabelText("Next 编辑器入口")).toHaveTextContent("旧账号");
    expect(fetchSpy).toHaveBeenNthCalledWith(
      3,
      "/api/auth/password/forgot",
      expect.objectContaining({
        body: JSON.stringify({ email: "legacy@example.com" }),
        method: "POST",
      }),
    );
    expectChallengeRequest(fetchSpy, 3, "reset-password");
    expectEncryptedRequest(
      fetchSpy,
      4,
      "/api/auth/password/reset",
      { email: "legacy@example.com" },
      ["654321", "replacement secure password"],
    );
  });

  it("explains when an authentication request cannot reach the server", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ error: "请先进入工作区" }, 401))
      .mockResolvedValueOnce(jsonResponse({ github: false }))
      .mockResolvedValueOnce(jsonResponse(challengeResponse("login")))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", fetchSpy);

    render(<EditorApp />);
    await user.type(await screen.findByLabelText("邮箱"), "linxia@example.com");
    await user.type(screen.getByLabelText("密码"), "correct horse battery staple");
    await user.click(screen.getByRole("button", { name: "登录" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("无法连接认证服务，请检查网络后重试");
    expect(screen.getByRole("alert")).not.toHaveTextContent("Failed to fetch");
    expectChallengeRequest(fetchSpy, 2, "login");
    expectEncryptedRequest(
      fetchSpy,
      3,
      "/api/auth/session",
      { email: "linxia@example.com" },
      ["correct horse battery staple"],
    );
  });

  it("explains when the authentication service returns an invalid response", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ error: "请先进入工作区" }, 401))
      .mockResolvedValueOnce(jsonResponse({ github: false }))
      .mockResolvedValueOnce(jsonResponse(challengeResponse("login")))
      .mockResolvedValueOnce(new Response("upstream failure", { status: 502 }));
    vi.stubGlobal("fetch", fetchSpy);

    render(<EditorApp />);
    await user.type(await screen.findByLabelText("邮箱"), "linxia@example.com");
    await user.type(screen.getByLabelText("密码"), "correct horse battery staple");
    await user.click(screen.getByRole("button", { name: "登录" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("认证服务响应异常，请稍后重试");
    expectChallengeRequest(fetchSpy, 2, "login");
    expectEncryptedRequest(
      fetchSpy,
      3,
      "/api/auth/session",
      { email: "linxia@example.com" },
      ["correct horse battery staple"],
    );
  });

  it("keeps login navigation disabled through challenge and final requests", async () => {
    const user = userEvent.setup();
    const challenge = deferred<Response>();
    const login = deferred<Response>();
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ error: "请先进入工作区" }, 401))
      .mockResolvedValueOnce(jsonResponse({ github: false }))
      .mockReturnValueOnce(challenge.promise)
      .mockReturnValueOnce(login.promise);
    vi.stubGlobal("fetch", fetchSpy);

    render(<EditorApp />);
    await user.type(await screen.findByLabelText("邮箱"), "linxia@example.com");
    await user.type(screen.getByLabelText("密码"), "correct horse battery staple");
    await user.click(screen.getByRole("button", { name: "登录" }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(3));
    const loginTab = screen.getByRole("tab", { name: "登录" });
    const registerTab = screen.getByRole("tab", { name: "注册" });
    const forgotButton = screen.getByRole("button", { name: "忘记密码" });
    expect(loginTab).toBeDisabled();
    expect(registerTab).toBeDisabled();
    expect(forgotButton).toBeDisabled();
    await user.click(registerTab);
    await user.click(forgotButton);
    expect(screen.queryByLabelText("姓名")).not.toBeInTheDocument();
    expect(screen.getByLabelText("密码")).toBeInTheDocument();

    challenge.resolve(jsonResponse(challengeResponse("login")));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(4));
    expectEncryptedRequest(
      fetchSpy,
      3,
      "/api/auth/session",
      { email: "linxia@example.com" },
      ["correct horse battery staple"],
    );
    expect(loginTab).toBeDisabled();
    expect(registerTab).toBeDisabled();
    expect(forgotButton).toBeDisabled();
    await user.click(registerTab);
    await user.click(forgotButton);
    expect(screen.queryByLabelText("姓名")).not.toBeInTheDocument();
    expect(screen.getByLabelText("密码")).toBeInTheDocument();

    login.resolve(jsonResponse({
      mode: "database",
      user: { displayName: "林夏", email: "linxia@example.com", id: "user-1" },
    }));
    expect(await screen.findByLabelText("Next 编辑器入口")).toHaveTextContent("林夏");
  });

  it("keeps code-mode back navigation disabled through challenge and final requests", async () => {
    const user = userEvent.setup();
    const challenge = deferred<Response>();
    const verification = deferred<Response>();
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ error: "请先进入工作区" }, 401))
      .mockResolvedValueOnce(jsonResponse({ github: false }))
      .mockResolvedValueOnce(jsonResponse(challengeResponse("register")))
      .mockResolvedValueOnce(jsonResponse({ registered: true, retryAfterSeconds: 60 }, 201))
      .mockReturnValueOnce(challenge.promise)
      .mockReturnValueOnce(verification.promise);
    vi.stubGlobal("fetch", fetchSpy);

    render(<EditorApp />);
    await user.click(await screen.findByRole("tab", { name: "注册" }));
    await user.type(screen.getByLabelText("姓名"), "林夏");
    await user.type(screen.getByLabelText("邮箱"), "linxia@example.com");
    await user.type(screen.getByLabelText("密码"), "correct horse battery staple");
    await user.click(screen.getByRole("button", { name: "创建账号" }));
    await user.type(await screen.findByLabelText("邮箱验证码"), "123456");
    expectEncryptedRequest(
      fetchSpy,
      3,
      "/api/auth/register",
      { displayName: "林夏", email: "linxia@example.com" },
      ["correct horse battery staple"],
    );
    await user.click(screen.getByRole("button", { name: "验证并进入工作区" }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(5));
    const backButton = screen.getByRole("button", { name: "返回注册" });
    expect(backButton).toBeDisabled();
    await user.click(backButton);
    expect(screen.getByLabelText("邮箱验证码")).toBeInTheDocument();

    challenge.resolve(jsonResponse(challengeResponse("verify-email")));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(6));
    expectEncryptedRequest(
      fetchSpy,
      5,
      "/api/auth/verify-email",
      { email: "linxia@example.com" },
      ["123456"],
    );
    expect(backButton).toBeDisabled();
    await user.click(backButton);
    expect(screen.getByLabelText("邮箱验证码")).toBeInTheDocument();

    verification.resolve(jsonResponse({
      user: { displayName: "林夏", email: "linxia@example.com", id: "user-1" },
      verified: true,
    }));
    expect(await screen.findByLabelText("Next 编辑器入口")).toHaveTextContent("林夏");
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

function challengeResponse(purpose: string) {
  return {
    algorithm: "RSA-OAEP-256",
    challenge: `opaque-${purpose}-challenge`,
    expiresAt: Date.now() + 60_000,
    key: publicJwk,
  };
}

function expectChallengeRequest(
  fetchMock: ReturnType<typeof vi.fn>,
  callIndex: number,
  purpose: string,
) {
  expect(fetchMock).toHaveBeenNthCalledWith(
    callIndex + 1,
    "/api/auth/credential-challenge",
    expect.objectContaining({ method: "POST" }),
  );
  expect(readRequestBody(fetchMock, callIndex)).toEqual({ purpose });
}

function expectEncryptedRequest(
  fetchMock: ReturnType<typeof vi.fn>,
  callIndex: number,
  endpoint: string,
  publicBody: Record<string, string>,
  secrets: string[],
) {
  expect(fetchMock).toHaveBeenNthCalledWith(
    callIndex + 1,
    endpoint,
    expect.objectContaining({ method: "POST" }),
  );
  const body = readRequestBody(fetchMock, callIndex);
  expect(body).toEqual({
    ...publicBody,
    credential: expect.any(String),
  });
  expect(body).not.toHaveProperty("password");
  expect(body).not.toHaveProperty("code");
  const serializedBody = JSON.stringify(body);
  for (const secret of secrets) {
    expect(serializedBody).not.toContain(secret);
  }
}

function readRequestBody(fetchMock: ReturnType<typeof vi.fn>, callIndex: number) {
  const init = fetchMock.mock.calls[callIndex]?.[1] as RequestInit | undefined;
  if (typeof init?.body !== "string") {
    throw new Error(`Fetch call ${callIndex + 1} has no JSON body`);
  }
  return JSON.parse(init.body) as Record<string, unknown>;
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
