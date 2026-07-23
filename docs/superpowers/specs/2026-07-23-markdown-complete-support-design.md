# Markdown Complete Support Design

Status: approved
Date: 2026-07-23

## Purpose

Extend the existing document-level Markdown import and export flow so CommonMark and GFM content is either represented by a native Nexus block or preserved losslessly in a safe Markdown block. Add client-side Mermaid and mathematical rendering without executing raw HTML, SVG, iframe, scripts, or arbitrary third-party extensions.

This design supersedes the raw-HTML rejection and unsupported-node rejection portions of `2026-07-22-m8-editor-operations-markdown-design-zh.md`. Existing limits, authorization, archive validation, and atomic import behavior remain in force.

## Scope

Supported authoring and round trips include:

- CommonMark block and inline syntax.
- GFM tables, task lists, strikethrough, autolinks, and footnotes.
- Display and inline mathematics.
- Mermaid fenced diagrams rendered in the client.
- Local image and attachment archives using the existing asset flow.
- Front matter, raw HTML, SVG, iframe, PlantUML, Vega, and unknown extension syntax preserved as source.

"Complete support" means no accepted Markdown source is silently dropped. It does not mean every third-party Markdown extension executes in the application. Mermaid is the only diagram extension rendered in this milestone. Other extensions remain editable and export unchanged.

## Architecture

### Native and source-preserving blocks

Keep the current mappings for headings, paragraphs, quotes, lists, todos, tables, code, dividers, images, attachments, and supported rich-text marks. Add a `markdown` block type with a `BlockData` variant:

```ts
type MarkdownBlockFlavor = "footnote" | "frontmatter" | "mermaid" | "rawHtml" | "unknownExtension";

interface MarkdownBlockData {
  kind: "markdown";
  flavor: MarkdownBlockFlavor;
  language: string;
}
```

`Block.content` stores the exact source slice for the Markdown block. `language` stores a fenced-code language when applicable; it is an empty string for non-code fragments. The source is not normalized before storage or export.

The importer examines every top-level mdast node and its descendants. If an entire node can map to the current native model, it does so. If it contains a construct that cannot map without changing meaning, the importer creates one Markdown block from that node's original source range instead. This protects inline footnote references, inline math, raw HTML, and unknown inline extensions from partial conversion.

### Parsing and serialization

The shared Markdown module remains the only place that translates between document data and Markdown. It uses Unified with the CommonMark parser, `remark-gfm`, and `remark-math`.

Import uses mdast source positions to slice the original text for preserved blocks. The first top-level H1 continues to become the document title only when that H1 maps natively. A preserved H1-like fragment stays in the body so its source is never altered.

Export serializes native blocks to deterministic Markdown. Markdown blocks append their stored source directly, with exactly one separating blank line when adjacent block output requires it. This makes preserved content survive import-export-import unchanged.

### Rendering

`MarkdownBlockEditor` has Preview and Source modes. Source mode is a normal editable textarea. Preview mode uses a client-only renderer:

- Math uses `remark-math`, `rehype-katex`, and KaTeX CSS.
- Mermaid dynamically loads Mermaid only in the browser and renders with `securityLevel: "strict"`.
- Invalid Mermaid source reports an inline diagnostic and leaves the source visible.
- Footnotes and unknown extensions render as readable source when no safe semantic renderer exists.
- Raw HTML, SVG, iframe, and script are escaped and displayed as source. The renderer never enables `rehype-raw` or injects untrusted HTML.

No renderer fetches remote content during import or preview. Existing local archive assets continue to use authorized file URLs; remote images remain safe links.

## User Experience

Normal Markdown retains the existing block-level editor. Complex syntax appears as a dedicated Markdown block with Preview and Source controls. Switching modes does not change its source. The command menu includes Markdown and Mermaid block creation so users can author preserved and rendered content without importing a file.

When an import falls back to a Markdown block, the preview reports a warning containing the source line and a reason such as `markdown_preserved`. This warning does not block importing. Syntax, size, authorization, archive, and unsafe-link failures continue to block atomically.

## Security and Limits

- Mermaid is isolated to a client-side component and configured for strict security.
- Raw HTML is neither parsed into DOM nor executed.
- Markdown links use the existing safe-protocol validation.
- The server reparses Markdown and does not trust browser conversion results.
- Current source, block count, nesting, archive, and attachment limits remain unchanged.
- A malformed Mermaid diagram is a non-blocking display diagnostic. It never prevents source editing or export.

## Compatibility

Existing documents contain no `markdown` block. Old documents continue to load unchanged. The new block type must be accepted by local persistence, PostgreSQL validation, collaboration structure mapping, clipboard validation, templates, command definitions, shared read-only views, and Markdown export.

An older client that does not recognize a new block type is not expected to render it. Deployment therefore requires server and web client rollout together. The database stores the existing discriminated block payload, so no data migration is required beyond allowing the new type and data variant in validation.

## Tests

Add focused tests for:

- CommonMark/GFM fixtures covering footnotes, strikethrough, autolinks, tables, task lists, nested content, and source ranges.
- Display and inline math import, preview, and deterministic export.
- Valid Mermaid preview, invalid Mermaid diagnostic, and source-mode editing.
- Raw HTML, SVG, and iframe preservation without DOM execution.
- PlantUML, Vega, front matter, and arbitrary fenced-language round trips.
- Unknown inline extensions causing preservation of the complete source node rather than text loss.
- Import-export-import semantic equality for native blocks and byte-preservation for Markdown blocks.
- Current Markdown archive, authorization, collaboration initialization, clipboard, and shared-view behavior.
- Browser-level import of a document that contains Mermaid, a footnote, math, and raw HTML, followed by a delayed collaboration connection.

## Acceptance Criteria

1. Any CommonMark/GFM input either maps to a native block or is retained in a Markdown block; it is never silently omitted.
2. Mermaid fenced blocks render in Preview mode, retain editable source, and export as their original fence.
3. Mathematical Markdown renders safely and exports without changing its intended notation.
4. Raw HTML, SVG, iframe, and scripts never execute in the application but export unchanged.
5. An invalid diagram shows a local diagnostic without losing content or blocking export.
6. Markdown import remains atomic for blocking errors, and the delayed collaboration initialization cannot replace imported content.
