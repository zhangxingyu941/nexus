import { pathToFileURL } from "node:url";

interface HealthcheckOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export async function checkServiceHealth(
  url: string,
  options: HealthcheckOptions = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 5000;
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error("Healthcheck timeout must be a positive integer");
  }

  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const response = await (options.fetchImpl ?? fetch)(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Healthcheck failed with HTTP ${response.status}`);
    }
  } catch (error) {
    if (timedOut) {
      throw new Error(`Healthcheck timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function main() {
  const url = process.argv[2] ?? process.env.HEALTHCHECK_URL ?? "http://127.0.0.1:3000/api/health";
  await checkServiceHealth(url);
  console.log(`Healthcheck passed for ${url}.`);
}

const entryPath = process.argv[1];
if (entryPath && import.meta.url === pathToFileURL(entryPath).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "Healthcheck failed");
    process.exitCode = 1;
  });
}
