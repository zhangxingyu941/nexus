# MVP Block Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first local-only Notion-style block editor with paragraph, heading, todo, reordering, and IndexedDB persistence.

**Architecture:** Use Vite + React + TypeScript for the app shell. Keep document behavior in pure model functions, keep IndexedDB behind a repository, and keep React components focused on rendering and dispatching operations. TipTap powers paragraph and heading text editing while storing plain text for the MVP.

**Tech Stack:** React, TypeScript, Vite, TipTap, IndexedDB via idb, Vitest, Testing Library, fake-indexeddb.

---

## File Structure

- `package.json`: scripts and dependencies.
- `vite.config.ts`: Vite and Vitest config.
- `src/main.tsx`: React entry.
- `src/App.tsx`: app shell.
- `src/features/editor/model/block.ts`: block and document types.
- `src/features/editor/model/documentOperations.ts`: pure document operations.
- `src/features/editor/model/documentOperations.test.ts`: operation tests.
- `src/features/editor/persistence/editorRepository.ts`: IndexedDB repository.
- `src/features/editor/persistence/editorRepository.test.ts`: repository tests.
- `src/features/editor/components/EditorPage.tsx`: editor state, loading, save flow.
- `src/features/editor/components/EditorToolbar.tsx`: title and save status.
- `src/features/editor/components/BlockList.tsx`: ordered block rendering.
- `src/features/editor/components/BlockRow.tsx`: block controls and editor selection.
- `src/features/editor/components/RichTextBlockEditor.tsx`: TipTap text editor wrapper.
- `src/features/editor/components/TodoBlockEditor.tsx`: todo checkbox and text input.
- `src/features/editor/components/EditorPage.test.tsx`: user-facing editor tests.
- `src/test/setup.ts`: test environment setup.
- `src/styles.css`: application styling.

## Tasks

### Task 1: Scaffold React TypeScript Project

**Files:**
- Create: `package.json`
- Create: `index.html`
- Create: `vite.config.ts`
- Create: `tsconfig.json`
- Create: `tsconfig.node.json`
- Create: `src/main.tsx`
- Create: `src/App.tsx`
- Create: `src/styles.css`
- Create: `src/test/setup.ts`

- [ ] **Step 1: Create Vite React TypeScript project files**

Create the project with React, Vite, TypeScript, Vitest, Testing Library, TipTap, idb, fake-indexeddb, and lucide-react dependencies.

- [ ] **Step 2: Install dependencies**

Run: `npm install`
Expected: dependencies install without errors.

- [ ] **Step 3: Verify starter app builds**

Run: `npm run build`
Expected: TypeScript and Vite build complete successfully.

- [ ] **Step 4: Commit scaffold**

Run: `git add . && git commit -m "chore: scaffold react editor app"`

### Task 2: Implement Document Model with TDD

**Files:**
- Create: `src/features/editor/model/block.ts`
- Create: `src/features/editor/model/documentOperations.ts`
- Create: `src/features/editor/model/documentOperations.test.ts`

- [ ] **Step 1: Write failing tests for document operations**

Tests must cover default document, insert, update content, change type, toggle todo, delete, and move.

- [ ] **Step 2: Run tests and verify failure**

Run: `npm test -- src/features/editor/model/documentOperations.test.ts --run`
Expected: FAIL because model files are missing or operations are not implemented.

- [ ] **Step 3: Implement model and operations**

Implement types and pure functions to satisfy the tests.

- [ ] **Step 4: Run tests and verify pass**

Run: `npm test -- src/features/editor/model/documentOperations.test.ts --run`
Expected: PASS.

- [ ] **Step 5: Commit model**

Run: `git add src/features/editor/model && git commit -m "feat: add block document model"`

### Task 3: Implement IndexedDB Repository with TDD

**Files:**
- Create: `src/features/editor/persistence/editorRepository.ts`
- Create: `src/features/editor/persistence/editorRepository.test.ts`
- Modify: `src/test/setup.ts`

- [ ] **Step 1: Write failing repository tests**

Tests must cover save/load and clear using fake-indexeddb.

- [ ] **Step 2: Run repository tests and verify failure**

Run: `npm test -- src/features/editor/persistence/editorRepository.test.ts --run`
Expected: FAIL because repository is missing.

- [ ] **Step 3: Implement repository**

Use `idb` to open `notion-block-editor` database and store one document under key `default`.

- [ ] **Step 4: Run repository tests and verify pass**

Run: `npm test -- src/features/editor/persistence/editorRepository.test.ts --run`
Expected: PASS.

- [ ] **Step 5: Commit repository**

Run: `git add src/features/editor/persistence src/test/setup.ts && git commit -m "feat: persist editor document locally"`

### Task 4: Build Editor UI with Component Tests

**Files:**
- Create: `src/features/editor/components/EditorPage.tsx`
- Create: `src/features/editor/components/EditorToolbar.tsx`
- Create: `src/features/editor/components/BlockList.tsx`
- Create: `src/features/editor/components/BlockRow.tsx`
- Create: `src/features/editor/components/RichTextBlockEditor.tsx`
- Create: `src/features/editor/components/TodoBlockEditor.tsx`
- Create: `src/features/editor/components/EditorPage.test.tsx`
- Modify: `src/App.tsx`
- Modify: `src/styles.css`

- [ ] **Step 1: Write failing component tests**

Tests must cover initial render, editing content, adding a block, changing block type, toggling todo, deleting a block, and moving blocks.

- [ ] **Step 2: Run component tests and verify failure**

Run: `npm test -- src/features/editor/components/EditorPage.test.tsx --run`
Expected: FAIL because UI components are missing.

- [ ] **Step 3: Implement editor components**

Build the UI around document operations. Use TipTap for paragraph and heading editors. Use a checkbox and text input for todo blocks.

- [ ] **Step 4: Run component tests and verify pass**

Run: `npm test -- src/features/editor/components/EditorPage.test.tsx --run`
Expected: PASS.

- [ ] **Step 5: Commit UI**

Run: `git add src && git commit -m "feat: build local block editor ui"`

### Task 5: Final Verification

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add README usage**

Document install, dev, test, and build commands.

- [ ] **Step 2: Run full test suite**

Run: `npm test -- --run`
Expected: PASS.

- [ ] **Step 3: Run production build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 4: Start dev server**

Run: `npm run dev -- --host 127.0.0.1`
Expected: Vite serves the app on a local URL.

- [ ] **Step 5: Browser smoke test**

Open the local URL and verify the editor renders, can add a block, edit content, convert to todo, toggle it, and move blocks.

- [ ] **Step 6: Commit final docs**

Run: `git add README.md docs/superpowers/plans/2026-06-10-mvp-block-editor.md && git commit -m "docs: add mvp implementation plan"`

