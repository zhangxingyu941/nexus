# Nexus Logo and Favicon Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the existing black rounded `N` badge into one shared SVG logo used by all five in-app brand surfaces and the browser tab.

**Architecture:** Add one static SVG in `public` and a small decorative `BrandMark` component that references it. Existing screens keep their current dimensions through per-call Tailwind size classes, while Next.js metadata points the browser favicon to the same asset.

**Tech Stack:** Next.js 15 App Router metadata, React, TypeScript, SVG, Tailwind CSS, Vitest, Testing Library

---

### Task 1: Add a failing brand-resource contract test

**Files:**
- Create: `src/components/BrandMark.test.ts`

- [ ] **Step 1: Write the failing static contract test**

Create `src/components/BrandMark.test.ts`:

```ts
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function readProjectFile(path: string) {
  return readFileSync(join(projectRoot, path), "utf8");
}

describe("Nexus brand mark", () => {
  it("provides one geometric SVG logo that stays crisp at favicon sizes", () => {
    const logoPath = join(projectRoot, "public", "nexus-logo.svg");
    expect(existsSync(logoPath)).toBe(true);

    const svg = existsSync(logoPath) ? readFileSync(logoPath, "utf8") : "";
    expect(svg).toContain('viewBox="0 0 32 32"');
    expect(svg).toContain('fill="#18181b"');
    expect(svg).toContain('fill="#fafafa"');
    expect(svg).toContain("<path");
    expect(svg).not.toContain("<text");
  });

  it("uses the shared logo on every brand surface and in page metadata", () => {
    const layout = readProjectFile("src/app/layout.tsx");
    const brandSources = [
      readProjectFile("src/app/AuthScreen.tsx"),
      readProjectFile("src/app/EditorApp.tsx"),
      readProjectFile("src/features/editor/components/WorkspaceSidebar.tsx"),
    ].join("\n");

    expect(layout).toContain('icon: "/nexus-logo.svg"');
    expect(brandSources.match(/<BrandMark\b/g) ?? []).toHaveLength(5);
  });
});
```

- [ ] **Step 2: Run the test and verify it fails for the missing shared resource**

Run:

```powershell
pnpm exec vitest run src/components/BrandMark.test.ts
```

Expected: FAIL because `public/nexus-logo.svg`, metadata configuration, and five `BrandMark` usages do not exist yet.

### Task 2: Create the shared SVG and React brand component

**Files:**
- Create: `public/nexus-logo.svg`
- Create: `src/components/BrandMark.tsx`

- [ ] **Step 1: Create the geometric SVG asset**

Create `public/nexus-logo.svg`:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" shape-rendering="geometricPrecision">
  <rect width="32" height="32" rx="6" fill="#18181b"/>
  <path d="M8 24V8h4l8 10.67V8h4v16h-4l-8-10.67V24H8Z" fill="#fafafa"/>
</svg>
```

- [ ] **Step 2: Create the decorative shared component**

Create `src/components/BrandMark.tsx`:

```tsx
import { cn } from "@/lib/utils";

interface BrandMarkProps {
  className?: string;
}

export function BrandMark({ className }: BrandMarkProps) {
  return (
    <img
      alt=""
      aria-hidden="true"
      className={cn("shrink-0", className)}
      height={32}
      src="/nexus-logo.svg"
      width={32}
    />
  );
}
```

### Task 3: Replace all in-app letter badges and configure the favicon

**Files:**
- Modify: `src/app/AuthScreen.tsx:15`
- Modify: `src/app/AuthScreen.tsx:228`
- Modify: `src/app/AuthScreen.tsx:423`
- Modify: `src/app/EditorApp.tsx:8`
- Modify: `src/app/EditorApp.tsx:84`
- Modify: `src/app/EditorApp.tsx:104`
- Modify: `src/features/editor/components/WorkspaceSidebar.tsx:10`
- Modify: `src/features/editor/components/WorkspaceSidebar.tsx:165`
- Modify: `src/app/layout.tsx:5`

- [ ] **Step 1: Replace the login-page marks**

Import the component in `src/app/AuthScreen.tsx`:

```ts
import { BrandMark } from "@/components/BrandMark";
```

Replace the mobile mark with:

```tsx
<BrandMark className="size-9" />
```

Replace the desktop brand-panel mark with:

```tsx
<BrandMark className="size-10 shadow-sm" />
```

- [ ] **Step 2: Replace the loading and error-state marks**

Import `BrandMark` in `src/app/EditorApp.tsx`, then replace the loading mark with:

```tsx
<BrandMark className="size-10 shadow-sm" />
```

Replace the error-state mark with:

```tsx
<BrandMark className="size-10" />
```

- [ ] **Step 3: Replace the workspace-sidebar mark**

Import `BrandMark` in `src/features/editor/components/WorkspaceSidebar.tsx`, then replace the existing three-line `N` div with:

```tsx
<BrandMark className="size-8 shadow-sm" />
```

- [ ] **Step 4: Point Next.js metadata to the shared SVG**

Update `src/app/layout.tsx`:

```ts
export const metadata: Metadata = {
  title: "Nexus",
  description: "面向协同办公场景的 Notion 风格块编辑器",
  icons: {
    icon: "/nexus-logo.svg",
  },
};
```

- [ ] **Step 5: Run the contract test and verify it passes**

Run:

```powershell
pnpm exec vitest run src/components/BrandMark.test.ts
```

Expected: PASS with 2 tests.

### Task 4: Run regression and visual verification

**Files:**
- Test: `src/app/EditorApp.test.tsx`
- Test: `src/features/editor/components/EditorPage.test.tsx`

- [ ] **Step 1: Run focused component regressions**

Run:

```powershell
pnpm exec vitest run src/components/BrandMark.test.ts src/app/EditorApp.test.tsx src/features/editor/components/EditorPage.test.tsx
```

Expected: all selected tests PASS with no warnings caused by `BrandMark`.

- [ ] **Step 2: Run TypeScript validation**

Run:

```powershell
pnpm exec tsc --noEmit
```

Expected: exit code `0` with no TypeScript errors.

- [ ] **Step 3: Start the development server and verify in the browser**

Run `pnpm dev` on an available port. Use the in-app browser to inspect a desktop viewport and a mobile viewport. Confirm:

- `/nexus-logo.svg` renders a nonblank 32px black rounded square with a white geometric `N`.
- the login-page desktop and mobile marks use the same asset without stretching or overlap.
- an authenticated/local workspace sidebar uses the 32px mark without changing header alignment.
- the document head includes an icon link resolving to `/nexus-logo.svg`.

- [ ] **Step 4: Run the full test suite**

Run:

```powershell
pnpm exec vitest run
```

Expected: all test files PASS.

- [ ] **Step 5: Inspect and commit only Logo implementation files**

Run:

```powershell
git diff --check
git add public/nexus-logo.svg src/components/BrandMark.tsx src/components/BrandMark.test.ts src/app/layout.tsx src/app/AuthScreen.tsx src/app/EditorApp.tsx src/features/editor/components/WorkspaceSidebar.tsx
git commit -m "feat: add shared Nexus logo and favicon"
```

Expected: the commit excludes the existing PRD, credential-key, package, lockfile, `.gitignore`, and `src/shared` changes.
