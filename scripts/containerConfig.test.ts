// @vitest-environment node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

describe("container configuration", () => {
  it("defines healthy PostgreSQL, Redis, migration, web, and collaboration services", async () => {
    const source = await readText("docker-compose.yml");
    const compose = parse(source) as {
      services?: Record<string, {
        depends_on?: Record<string, { condition?: string }>;
        healthcheck?: unknown;
      }>;
      volumes?: Record<string, unknown>;
    } | null;
    const services = compose?.services ?? {};

    expect(Object.keys(services).sort()).toEqual([
      "collaboration",
      "migrate",
      "postgres",
      "redis",
      "web",
    ]);
    for (const serviceName of ["postgres", "redis", "web", "collaboration"]) {
      expect(services[serviceName]?.healthcheck).toBeDefined();
    }
    expect(services.migrate?.depends_on?.postgres?.condition).toBe("service_healthy");
    expect(services.migrate?.depends_on?.redis?.condition).toBe("service_healthy");
    expect(services.web?.depends_on?.migrate?.condition).toBe("service_completed_successfully");
    expect(services.collaboration?.depends_on?.migrate?.condition).toBe("service_completed_successfully");
    expect(Object.keys(compose?.volumes ?? {}).sort()).toEqual([
      "postgres_data",
      "redis_data",
      "uploads_data",
    ]);
  });

  it("builds locked multi-stage images and runs application targets as non-root users", async () => {
    const dockerfile = await readText("Dockerfile");
    const nextConfig = await readText("next.config.mjs");
    const dockerignore = await readText(".dockerignore");
    const packageJson = JSON.parse(await readText("package.json")) as { packageManager?: string };

    expect(dockerfile).toMatch(/AS deps/i);
    expect(dockerfile).toMatch(/AS builder/i);
    expect(dockerfile).toMatch(/AS migration/i);
    expect(dockerfile).toMatch(/AS collaboration/i);
    expect(dockerfile).toMatch(/AS runner/i);
    expect(dockerfile).toContain("pnpm install --frozen-lockfile");
    expect(dockerfile).toContain("npm install --global pnpm@10.12.1");
    expect(dockerfile).toContain("ENV NEXT_OUTPUT=standalone");
    expect(dockerfile).toContain("/app/.next/standalone");
    expect(dockerfile).toContain("/app/public ./public");
    expect(dockerfile).toMatch(/USER (node|nextjs)/);
    expect(nextConfig).toContain('process.env.NEXT_OUTPUT === "standalone"');
    expect(dockerignore).toContain(".env");
    expect(dockerignore).toContain("node_modules");
    expect(dockerignore).toContain(".next");
    expect(packageJson.packageManager).toBe("pnpm@10.12.1");
  });
});

async function readText(path: string) {
  return readFile(resolve(path), "utf8").catch(() => "");
}
