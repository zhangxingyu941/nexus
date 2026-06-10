import { beforeEach, describe, expect, it } from "vitest";
import { createDefaultDocument, updateBlockContent } from "../model/documentOperations";
import { clearDocument, loadDocument, saveDocument } from "./editorRepository";

describe("editor repository", () => {
  beforeEach(async () => {
    await clearDocument();
  });

  it("saves and loads the editor document", async () => {
    const document = updateBlockContent(createDefaultDocument(1000), "block-1000", "Saved locally", 2000);

    await saveDocument(document);

    await expect(loadDocument()).resolves.toEqual(document);
  });

  it("clears the saved document", async () => {
    await saveDocument(createDefaultDocument(1000));
    await clearDocument();

    await expect(loadDocument()).resolves.toBeNull();
  });
});
