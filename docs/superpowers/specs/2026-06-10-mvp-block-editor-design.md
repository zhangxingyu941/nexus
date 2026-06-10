# First Version Block Editor Design

## Overview

The first version builds a local-only Notion-style block editor. It validates the block data model, editing flow, local persistence, and basic UI before adding collaboration or a backend.

This version intentionally excludes realtime collaboration, login, server persistence, nested blocks, files, images, history, and slash commands. Those are later milestones in `docs/prd.md`.

## Product Scope

The application opens directly into a single editable document. The user can create, edit, delete, reorder, and persist blocks locally.

Supported block types:

- Paragraph block for normal text.
- Heading block for prominent section text.
- Todo block with checked state and editable label.

Required operations:

- Create a new paragraph block after the current block.
- Delete a block while keeping at least one empty paragraph in the document.
- Change a block type between paragraph, heading, and todo.
- Edit block text.
- Toggle a todo block.
- Move a block up or down.
- Save the document to IndexedDB and restore it after refresh.

## Architecture

The app uses React with Vite. Editing state is held in React and updated through a focused document reducer. Persistence is isolated behind an IndexedDB repository so UI components do not know storage details.

TipTap is used for paragraph and heading text editing so the first version starts from the same editor family that can later connect to Yjs. The first version stores plain text per block instead of rich TipTap JSON to keep the MVP small and easy to test.

## Main Units

### Document Model

The core model lives in `src/features/editor/model/block.ts`.

```ts
export type BlockType = "paragraph" | "heading" | "todo";

export interface Block {
  id: string;
  type: BlockType;
  content: string;
  checked: boolean;
  parentId: string | null;
  children: string[];
  createdAt: number;
  updatedAt: number;
}

export interface EditorDocument {
  id: string;
  title: string;
  blocks: Block[];
  updatedAt: number;
}
```

Todo blocks use `checked`; paragraph and heading blocks keep the property as `false` for a uniform shape.

### Document Operations

State operations live in `src/features/editor/model/documentOperations.ts`.

They provide pure functions for:

- `createDefaultDocument`
- `insertBlockAfter`
- `updateBlockContent`
- `changeBlockType`
- `toggleTodo`
- `deleteBlock`
- `moveBlock`

These functions are covered by unit tests and do not depend on React, TipTap, IndexedDB, or the DOM.

### Persistence

IndexedDB access lives in `src/features/editor/persistence/editorRepository.ts`.

The repository exposes:

- `loadDocument(): Promise<EditorDocument | null>`
- `saveDocument(document: EditorDocument): Promise<void>`
- `clearDocument(): Promise<void>`

The app debounces saves after document changes. A save status indicator shows one of:

- `Saved`
- `Saving`
- `Unsaved`
- `Save failed`

If saving fails, the current in-memory document remains editable.

### React Components

The UI is split into small components:

- `App`: page shell and editor composition.
- `EditorPage`: loads persisted data, owns document state, triggers persistence.
- `EditorToolbar`: title and save status.
- `BlockList`: renders blocks in order.
- `BlockRow`: renders block controls and delegates editing to type-specific UI.
- `RichTextBlockEditor`: wraps TipTap for paragraph and heading text.
- `TodoBlockEditor`: renders a checkbox plus text editor.

## Data Flow

1. App mounts.
2. `EditorPage` calls `loadDocument`.
3. If a saved document exists, it becomes the current state.
4. If no document exists, `createDefaultDocument` creates one empty paragraph block.
5. User edits blocks through UI.
6. UI dispatches pure document operations.
7. Document changes trigger a debounced `saveDocument`.
8. Save status updates based on repository result.

## Interaction Details

Text editing:

- Paragraph and heading blocks use TipTap.
- Todo text can use the same TipTap wrapper or a plain input if TipTap integration becomes awkward for checkbox layout.
- Pressing Enter in a text block inserts a paragraph block after the current block.

Block controls:

- Type selector offers Paragraph, Heading, and Todo.
- Icon buttons support add, delete, move up, and move down.
- Move up is disabled for the first block.
- Move down is disabled for the last block.
- Delete keeps at least one empty paragraph block.

## Styling

The interface should feel like a focused editing tool rather than a marketing page. It uses a restrained layout with:

- A centered document canvas.
- A compact top bar with title and save status.
- Clear block controls that appear consistently.
- Comfortable text spacing.
- Distinct heading and todo presentation.

Cards are not nested. The editor surface is the primary workspace, with repeated rows for blocks.

## Error Handling

- Load failure falls back to a default empty document and shows a non-blocking error state.
- Save failure changes the save indicator to `Save failed`; editing continues.
- Invalid block IDs in operations return the original document.
- Delete and move operations clamp unsafe cases instead of throwing in the UI path.

## Testing Strategy

Unit tests cover document operations:

- default document contains one paragraph block.
- insert after block creates a paragraph in the correct position.
- content update changes only the target block and updates timestamps.
- type change resets todo checked state when leaving todo.
- todo toggle changes only the target todo block.
- delete removes a block and preserves at least one block.
- move up and down reorder blocks correctly.

Persistence tests cover the repository with fake IndexedDB:

- saving then loading returns the same document.
- clearing removes the saved document.

Component tests cover:

- rendering a default editor.
- editing block content.
- adding and deleting blocks.
- moving blocks.
- toggling a todo.

## Acceptance Criteria

- `npm run dev` starts the app.
- `npm test` passes.
- The editor opens to a usable single document page.
- Paragraph, heading, and todo blocks can be edited.
- Blocks can be added, deleted, converted, and moved.
- Refreshing the browser restores the saved document.
- Save status reflects local persistence state.

