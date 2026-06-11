# Multi Document Collab Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the approved Notion-like multi-document workspace with a left page tree, collaborative top bar, and a focused right-side block editor.

**Architecture:** Add an `EditorWorkspace` model that owns many `EditorDocument` records plus the active document id. Keep existing pure document operations and compose them through workspace operations, then persist the full workspace in IndexedDB with migration from the old single-document key.

**Tech Stack:** React, TypeScript, TipTap, IndexedDB via `idb`, Vitest, Testing Library, Vite.

---

### Task 1: Workspace Model

**Files:**
- Modify: `src/features/editor/model/block.ts`
- Create: `src/features/editor/model/workspaceOperations.ts`
- Create: `src/features/editor/model/workspaceOperations.test.ts`

- [ ] **Step 1: Write failing tests for workspace operations**

Add tests for:

```ts
import { describe, expect, it } from "vitest";
import {
  createDefaultWorkspace,
  createWorkspaceDocument,
  getActiveDocument,
  switchActiveDocument,
  updateActiveDocument,
} from "./workspaceOperations";
import { updateBlockContent } from "./documentOperations";

describe("workspace operations", () => {
  it("creates a default workspace with one active document", () => {
    const workspace = createDefaultWorkspace(1000);

    expect(workspace.activeDocumentId).toBe("document-1000");
    expect(workspace.updatedAt).toBe(1000);
    expect(workspace.documents).toHaveLength(1);
    expect(workspace.documents[0]).toMatchObject({
      id: "document-1000",
      title: "未命名文档",
      updatedAt: 1000,
    });
  });

  it("creates and selects a new document", () => {
    const workspace = createDefaultWorkspace(1000);
    const next = createWorkspaceDocument(workspace, 2000);

    expect(next.documents).toHaveLength(2);
    expect(next.activeDocumentId).toBe("document-2000");
    expect(getActiveDocument(next)?.id).toBe("document-2000");
  });

  it("switches to an existing document only", () => {
    const workspace = createWorkspaceDocument(createDefaultWorkspace(1000), 2000);
    const switched = switchActiveDocument(workspace, "document-1000", 3000);
    const unchanged = switchActiveDocument(switched, "missing", 4000);

    expect(switched.activeDocumentId).toBe("document-1000");
    expect(switched.updatedAt).toBe(3000);
    expect(unchanged).toBe(switched);
  });

  it("updates only the active document", () => {
    const workspace = createWorkspaceDocument(createDefaultWorkspace(1000), 2000);
    const activeId = workspace.activeDocumentId;
    const next = updateActiveDocument(
      workspace,
      (document) => updateBlockContent(document, document.blocks[0].id, "当前文档内容", 3000),
      3000,
    );

    expect(getActiveDocument(next)?.blocks[0].content).toBe("当前文档内容");
    expect(next.documents.find((document) => document.id !== activeId)?.blocks[0].content).toBe("");
  });
});
```

- [ ] **Step 2: Verify the tests fail**

Run: `npm test -- src/features/editor/model/workspaceOperations.test.ts --run`

Expected: fail because `workspaceOperations.ts` does not exist.

- [ ] **Step 3: Implement workspace operations**

Add `EditorWorkspace` to `block.ts` and implement the pure helpers in `workspaceOperations.ts`. Reuse `createDefaultDocument`; add an optional document id parameter if needed so deterministic IDs are testable.

- [ ] **Step 4: Verify model tests pass**

Run: `npm test -- src/features/editor/model/workspaceOperations.test.ts --run`

Expected: pass.

### Task 2: Workspace Persistence

**Files:**
- Modify: `src/features/editor/persistence/editorRepository.ts`
- Modify: `src/features/editor/persistence/editorRepository.test.ts`

- [ ] **Step 1: Write failing persistence tests**

Cover saving/loading a workspace, clearing the workspace, and migrating an old single document into a workspace.

- [ ] **Step 2: Verify persistence tests fail**

Run: `npm test -- src/features/editor/persistence/editorRepository.test.ts --run`

Expected: fail because `loadWorkspace`, `saveWorkspace`, or migration behavior is missing.

- [ ] **Step 3: Implement repository changes**

Keep `loadDocument`, `saveDocument`, and `clearDocument` only if needed for migration tests, but route the app through:

```ts
loadWorkspace(): Promise<EditorWorkspace | null>
saveWorkspace(workspace: EditorWorkspace): Promise<void>
clearWorkspace(): Promise<void>
```

Use the same object store and add a new key, for example `workspace`.

- [ ] **Step 4: Verify persistence tests pass**

Run: `npm test -- src/features/editor/persistence/editorRepository.test.ts --run`

Expected: pass.

### Task 3: Workspace UI Behavior

**Files:**
- Modify: `src/features/editor/components/EditorPage.test.tsx`
- Modify: `src/features/editor/components/EditorPage.tsx`
- Create: `src/features/editor/components/WorkspaceSidebar.tsx`
- Create: `src/features/editor/components/DocumentEditor.tsx`
- Modify: `src/features/editor/components/EditorToolbar.tsx` or replace it from `DocumentEditor`

- [ ] **Step 1: Write failing component tests**

Update component tests to expect:

- `团队知识库`
- `新建文档`
- `项目空间`
- `产品方案草稿` or `未命名文档`
- `评论 3`
- `分享`
- a right-side `文档编辑区`

Add tests that clicking `新建文档` increases the document count and switches the editor to the new document.

- [ ] **Step 2: Verify component tests fail**

Run: `npm test -- src/features/editor/components/EditorPage.test.tsx --run`

Expected: fail because the current UI is still single-document.

- [ ] **Step 3: Implement workspace state in `EditorPage`**

Load/save `EditorWorkspace`, expose handlers for create document and switch document, and wrap existing block operations so they apply to the active document only.

- [ ] **Step 4: Implement `WorkspaceSidebar`**

Render a Notion-like page tree with workspace title, quick actions, `新建文档`, document buttons, active state, and sync text.

- [ ] **Step 5: Implement `DocumentEditor`**

Render the collaborative top bar, cover, document icon, title, save status, metadata pills, and `BlockList`.

- [ ] **Step 6: Verify component tests pass**

Run: `npm test -- src/features/editor/components/EditorPage.test.tsx --run`

Expected: pass.

### Task 4: Notion-Like Styling

**Files:**
- Modify: `src/styles.css`

- [ ] **Step 1: Port visual language from preview**

Apply the approved palette, page tree layout, sticky collaborative top bar, document cover, document icon, large title, metadata pills, hover-only block controls, inline comment callout, slash hint, and responsive behavior.

- [ ] **Step 2: Verify build**

Run: `npm run build`

Expected: TypeScript and Vite build pass.

### Task 5: Full Verification

**Files:**
- No code edits unless failures reveal a bug.

- [ ] **Step 1: Run all automated tests**

Run: `npm test -- --run`

Expected: all tests pass.

- [ ] **Step 2: Run production build**

Run: `npm run build`

Expected: build passes.

- [ ] **Step 3: Browser smoke test**

Open `http://127.0.0.1:5173/` and verify:

- Sidebar shows `团队知识库`, `新建文档`, and document list.
- Right side shows document cover, title, save status, online avatars, `评论 3`, `历史`, and `分享`.
- Existing block editing still works.
- `新建文档` creates and selects a new document.
- Switching documents changes the active editor.

- [ ] **Step 4: Commit implementation**

Commit after tests, build, and browser smoke pass.
