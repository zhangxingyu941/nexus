import { spawn } from "node:child_process";
import {
  formatChildProcessStartErrorMessage,
  formatPortInUseMessage,
  getCollaborationServerArgs,
  isTcpPortAvailable,
  resolveCollaborationServerCommand,
  stopProcessTree,
} from "./processTree.mjs";

const command = resolveCollaborationServerCommand();
const args = getCollaborationServerArgs();
const host = process.env.COLLAB_HOST ?? process.env.HOST ?? "0.0.0.0";
const port = process.env.COLLAB_PORT ?? process.env.PORT ?? "1234";

if (!(await isTcpPortAvailable(host, port))) {
  console.error(formatPortInUseMessage(host, port));
  process.exitCode = 1;
  process.exit();
}
const child = spawn(command, args, {
  env: {
    ...process.env,
    HOST: host,
    PORT: port,
  },
  shell: true,
  stdio: ["ignore", "pipe", "pipe"],
});

child.stdout?.on("data", (chunk) => process.stdout.write(chunk));
child.stderr?.on("data", (chunk) => process.stderr.write(chunk));

child.on("exit", (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});

child.on("error", (error) => {
  console.error(formatChildProcessStartErrorMessage("协同服务", error.message));
  process.exitCode = 1;
});

process.on("SIGINT", () => {
  stopProcessTree(child);
});

process.on("SIGTERM", () => {
  stopProcessTree(child);
});
