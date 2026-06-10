# Notion Block Editor

Local-first Notion-style block editor MVP built with React, TipTap, and IndexedDB.

## First Version Scope

- Single editable document.
- Paragraph, heading, and todo blocks.
- Add, delete, convert, and move blocks.
- Local persistence through IndexedDB.
- Automated tests for document operations, persistence, and main editor interactions.

## Commands

```bash
npm install
npm run dev
npm test -- --run
npm run build
```

## Development Notes

The first version is intentionally local-only. Realtime collaboration, backend persistence, login, nested blocks, image/file blocks, and slash commands are documented as later phases in `docs/prd.md`.

