import { spawn } from "node:child_process";
import {
  formatChildProcessExitMessage,
  formatChildProcessStartErrorMessage,
  stopProcessTree,
} from "./processTree.mjs";

const pnpmCommand = "pnpm";
const children = new Set();
let shuttingDown = false;

function stopChildren() {
  for (const child of children) {
    stopProcessTree(child);
  }
}

function startProcess(name, args, env = process.env) {
  const child = spawn(pnpmCommand, args, {
    env,
    shell: true,
    stdio: ["ignore", "pipe", "pipe"],
  });

  children.add(child);
  child.stdout?.on("data", (chunk) => process.stdout.write(chunk));
  child.stderr?.on("data", (chunk) => process.stderr.write(chunk));

  child.on("exit", (code, signal) => {
    children.delete(child);

    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    stopChildren();
    process.exitCode = code ?? (signal ? 1 : 0);
    console.error(formatChildProcessExitMessage(name, code));
  });

  child.on("error", (error) => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    stopChildren();
    process.exitCode = 1;
    console.error(formatChildProcessStartErrorMessage(name, error.message));
  });
}

process.on("SIGINT", () => {
  shuttingDown = true;
  stopChildren();
});

process.on("SIGTERM", () => {
  shuttingDown = true;
  stopChildren();
});

startProcess("协同服务", ["dev:collab"], process.env);
startProcess("Next 开发服务", ["dev"]);
