import { spawn } from "node:child_process";
import { createServer } from "node:net";

export const COLLABORATION_SERVER_COMMAND = "pnpm";
export const COLLABORATION_SERVER_ARGS = ["exec", "tsx", "scripts/collaboration-server.ts"];

/**
 * 根据当前平台解析命令名。
 * Windows 需要通过 .cmd shim 启动 npm/pnpm bin，类 Unix 平台直接使用原命令名。
 */
export function resolveExecutable(command, platform = process.platform) {
  // Windows 下 pnpm/y-websocket 等可执行文件通常通过 .cmd shim 暴露。
  return platform === "win32" ? `${command}.cmd` : command;
}

/**
 * 解析协同服务命令。
 * 通过 tsx 启动项目内的鉴权服务器，避免绕过会话和工作区权限。
 */
export function resolveCollaborationServerCommand(platform = process.platform) {
  return resolveExecutable(COLLABORATION_SERVER_COMMAND, platform);
}

export function getCollaborationServerArgs() {
  return [...COLLABORATION_SERVER_ARGS];
}

/**
 * 检查指定 host:port 是否还能被当前进程监听。
 * 返回 true 表示端口可用，返回 false 表示端口无效、已被占用或当前环境不允许监听。
 */
export function isTcpPortAvailable(host, port) {
  const numericPort = Number(port);

  if (!Number.isInteger(numericPort) || numericPort <= 0 || numericPort > 65535) {
    return Promise.resolve(false);
  }

  return new Promise((resolve) => {
    // 通过临时监听目标端口判断是否可用；监听成功后立即关闭，不长期占用。
    const server = createServer();
    let settled = false;

    function finish(isAvailable) {
      if (settled) {
        return;
      }

      settled = true;
      server.removeAllListeners();

      if (server.listening) {
        server.close(() => resolve(isAvailable));
        return;
      }

      resolve(isAvailable);
    }

    server.once("error", () => finish(false));
    server.once("listening", () => finish(true));
    server.listen(numericPort, host);
  });
}

/**
 * 生成协同服务端口冲突提示。
 * 供 dev-collab 脚本在启动前检测到端口占用时统一输出。
 */
export function formatPortInUseMessage(host, port) {
  // 统一端口冲突提示，避免开发者把协同服务未启动误判为 Next 卡住。
  return [
    `协同服务端口 ${port} 已被占用（${host}:${port}）。`,
    "请先停止占用该端口的进程，或设置 COLLAB_PORT / PORT 使用其它端口后重试。",
  ].join("\n");
}

/**
 * 生成子进程退出提示。
 * 供 fullstack 启动脚本在任一子服务退出时输出一致的中文信息。
 */
export function formatChildProcessExitMessage(name, code) {
  return code === null ? `${name}已退出。` : `${name}已退出，退出码 ${code}。`;
}

/**
 * 生成子进程启动失败提示。
 * 供协同和 fullstack 启动脚本统一输出中文错误。
 */
export function formatChildProcessStartErrorMessage(name, errorMessage) {
  return `${name}启动失败：${errorMessage}`;
}

/**
 * 停止子进程及其派生进程。
 * Windows 使用 taskkill /t 清理整棵进程树，其它平台直接向子进程发送指定 signal。
 */
export function stopProcessTree(child, options = {}) {
  const platform = options.platform ?? process.platform;
  const spawnProcess = options.spawn ?? spawn;
  const signal = options.signal ?? "SIGTERM";

  if (!child || child.killed) {
    return;
  }

  if (platform === "win32" && child.pid) {
    // Windows 的 child.kill 只结束父进程；taskkill /t 才能清理 pnpm/cmd/node 子进程树。
    const killer = spawnProcess("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
      shell: false,
      stdio: "ignore",
    });
    killer.once?.("error", () => {
      child.kill(signal);
    });
    return;
  }

  child.kill(signal);
}
