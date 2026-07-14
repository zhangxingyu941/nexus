import { createServer } from "node:net";
import { describe, expect, test, vi } from "vitest";

import {
  formatChildProcessExitMessage,
  formatChildProcessStartErrorMessage,
  formatPortInUseMessage,
  getCollaborationServerArgs,
  isTcpPortAvailable,
  resolveCollaborationServerCommand,
  resolveExecutable,
  stopProcessTree,
} from "./processTree.mjs";

describe("process tree helpers", () => {
  test("uses taskkill to stop a Windows child process tree", () => {
    const child = {
      killed: false,
      kill: vi.fn(),
      pid: 1234,
    };
    const spawn = vi.fn(() => ({
      once: vi.fn(),
    }));

    stopProcessTree(child, { platform: "win32", spawn });

    expect(spawn).toHaveBeenCalledWith("taskkill", ["/pid", "1234", "/t", "/f"], {
      shell: false,
      stdio: "ignore",
    });
    expect(child.kill).not.toHaveBeenCalled();
  });

  test("falls back to child.kill outside Windows", () => {
    const child = {
      killed: false,
      kill: vi.fn(),
      pid: 1234,
    };
    const spawn = vi.fn();

    stopProcessTree(child, { platform: "linux", spawn });

    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    expect(spawn).not.toHaveBeenCalled();
  });

  test("resolves cmd shims on Windows", () => {
    expect(resolveExecutable("pnpm", "win32")).toBe("pnpm.cmd");
    expect(resolveExecutable("pnpm", "linux")).toBe("pnpm");
  });

  test("uses the authenticated TypeScript collaboration server", () => {
    expect(resolveCollaborationServerCommand("win32")).toBe("pnpm.cmd");
    expect(resolveCollaborationServerCommand("linux")).toBe("pnpm");
    expect(getCollaborationServerArgs()).toEqual(["exec", "tsx", "scripts/collaboration-server.ts"]);
  });

  test("detects when a tcp port is already occupied", async () => {
    const server = createServer();

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();

    if (!address || typeof address === "string") {
      throw new Error("Expected a tcp address.");
    }

    await expect(isTcpPortAvailable("127.0.0.1", String(address.port))).resolves.toBe(false);

    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  });

  test("formats a clear collaboration port conflict message", () => {
    const message = formatPortInUseMessage("0.0.0.0", "1234");

    expect(message).toContain("协同服务端口 1234 已被占用");
    expect(message).toContain("COLLAB_PORT");
  });

  test("formats child process lifecycle messages in Chinese", () => {
    expect(formatChildProcessExitMessage("协同服务", 1)).toBe("协同服务已退出，退出码 1。");
    expect(formatChildProcessExitMessage("Next 开发服务", null)).toBe("Next 开发服务已退出。");
    expect(formatChildProcessStartErrorMessage("协同服务", "spawn failed")).toBe(
      "协同服务启动失败：spawn failed",
    );
  });
});
