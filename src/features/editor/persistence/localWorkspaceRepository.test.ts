import { openDB } from "idb";
import { describe, expect, it } from "vitest";
import { createDefaultDocument, updateBlockContent } from "../model/documentOperations";
import { createDefaultWorkspace, createWorkspaceDocument, normalizeWorkspace } from "../model/workspaceOperations";
import { createLocalWorkspaceRepository } from "./localWorkspaceRepository";

describe("local workspace repository", () => {
  it("migrates a legacy workspace and keeps workspace content isolated", async () => {
    const databaseName = uniqueDatabaseName("workspace");
    const legacy = createWorkspaceDocument(createDefaultWorkspace(1000), 1500, "Legacy second document");
    await seedLegacyDatabase(databaseName, "workspace", legacy);
    const repository = createLocalWorkspaceRepository({
      databaseName,
      idFactory: () => "local-2",
      now: () => 2000,
    });

    const catalog = await repository.list();
    expect(catalog.currentWorkspaceId).toBe("local-default");
    expect(catalog.workspaces).toEqual([
      expect.objectContaining({ id: "local-default", name: "Nexus 工作区", role: "owner" }),
    ]);
    await expect(repository.load("local-default")).resolves.toMatchObject({
      content: normalizeWorkspace(legacy),
      summary: { id: "local-default", role: "owner" },
    });
    const migratedDatabase = await openDB(databaseName, 2);
    await expect(migratedDatabase.get("documents", "workspace")).resolves.toBeUndefined();
    await expect(migratedDatabase.get("documents", "default")).resolves.toBeUndefined();
    await expect(migratedDatabase.get("preferences", "v2MigrationComplete")).resolves.toBe(true);
    migratedDatabase.close();

    const created = await repository.create("研发中心");
    const workspaceB = createWorkspaceDocument(createDefaultWorkspace(3000), 4000, "Workspace B only");
    await repository.save(created.summary.id, workspaceB);

    expect((await repository.list()).currentWorkspaceId).toBe("local-2");
    await expect(repository.load("local-default")).resolves.toMatchObject({
      content: normalizeWorkspace(legacy),
    });
    await expect(repository.load("local-2")).resolves.toMatchObject({
      content: normalizeWorkspace(workspaceB),
    });
  });

  it("migrates a legacy default document into the default workspace", async () => {
    const databaseName = uniqueDatabaseName("document");
    const legacyDocument = updateBlockContent(
      createDefaultDocument(1000),
      "block-1000",
      "Legacy local content",
      1500,
    );
    await seedLegacyDatabase(databaseName, "default", legacyDocument);
    const repository = createLocalWorkspaceRepository({ databaseName, now: () => 2000 });

    const snapshot = await repository.load("local-default");

    expect(snapshot.summary).toMatchObject({ name: "Nexus 工作区", role: "owner" });
    expect(snapshot.content).toEqual(normalizeWorkspace({
      activeDocumentId: legacyDocument.id,
      documents: [legacyDocument],
      updatedAt: legacyDocument.updatedAt,
    }));
  });

  it("creates one default workspace for an empty database and migrates only once", async () => {
    const databaseName = uniqueDatabaseName("empty");
    await seedLegacyDatabase(databaseName);
    const firstRepository = createLocalWorkspaceRepository({ databaseName, now: () => 2000 });
    const secondRepository = createLocalWorkspaceRepository({ databaseName, now: () => 3000 });

    const firstCatalog = await firstRepository.list();
    const secondCatalog = await secondRepository.list();

    expect(firstCatalog.currentWorkspaceId).toBe("local-default");
    expect(firstCatalog.workspaces).toHaveLength(1);
    expect(secondCatalog).toEqual(firstCatalog);
    await expect(secondRepository.load("local-default")).resolves.toMatchObject({
      content: { documents: [expect.objectContaining({ title: "未命名文档" })] },
      summary: { name: "Nexus 工作区", role: "owner" },
    });
  });

  it("renames and selects existing workspaces while rejecting missing IDs", async () => {
    const databaseName = uniqueDatabaseName("contract");
    const repository = createLocalWorkspaceRepository({
      databaseName,
      idFactory: () => "local-2",
      now: () => 2000,
    });
    await repository.list();
    const created = await repository.create("  产品团队  ");

    await expect(repository.rename(created.summary.id, "  研发中心  ")).resolves.toMatchObject({
      id: "local-2",
      name: "研发中心",
      role: "owner",
    });
    await expect(repository.select("local-default")).resolves.toMatchObject({
      summary: { id: "local-default" },
    });
    expect((await repository.list()).currentWorkspaceId).toBe("local-default");
    await expect(repository.load("missing")).rejects.toThrow("工作区不存在");
    await expect(repository.rename("missing", "Missing")).rejects.toThrow("工作区不存在");
    await expect(repository.select("missing")).rejects.toThrow("工作区不存在");
    await expect(repository.save("missing", createDefaultWorkspace(5000))).rejects.toThrow("工作区不存在");
  });

  it("keeps create atomic when the generated workspace ID already exists", async () => {
    const databaseName = uniqueDatabaseName("collision");
    const repository = createLocalWorkspaceRepository({
      databaseName,
      idFactory: () => "local-duplicate",
      now: () => 2000,
    });
    await repository.list();
    await repository.create("First duplicate");

    await expect(repository.create("Second duplicate")).rejects.toThrow();

    const catalog = await repository.list();
    expect(catalog.currentWorkspaceId).toBe("local-duplicate");
    expect(catalog.workspaces.map((workspace) => workspace.id)).toEqual([
      "local-duplicate",
      "local-default",
    ]);
  });
});

async function seedLegacyDatabase(databaseName: string, key?: string, value?: unknown) {
  const database = await openDB(databaseName, 1, {
    upgrade(upgradeDatabase) {
      upgradeDatabase.createObjectStore("documents");
    },
  });
  if (key) {
    await database.put("documents", value, key);
  }
  database.close();
}

let databaseSequence = 0;

function uniqueDatabaseName(label: string) {
  databaseSequence += 1;
  return `local-workspace-repository-${label}-${databaseSequence}`;
}
