# Nexus Logo 与 Favicon 实施计划

> **致自动化代理：** 必需子技能：请使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 逐任务实施本计划。步骤使用复选框（`- [ ]`）语法进行跟踪。

**目标：** 将现有的黑色圆角 `N` 徽标转换为一个共享的 SVG Logo，供应用内所有五个品牌展示面和浏览器标签页使用。

**架构：** 在 `public` 中添加一个静态 SVG 和一个引用它的装饰性 `BrandMark` 组件。现有屏幕通过每次调用的 Tailwind 尺寸类保持当前尺寸，同时 Next.js metadata 将浏览器 favicon 指向同一资源。

**技术栈：** Next.js 15 App Router metadata、React、TypeScript、SVG、Tailwind CSS、Vitest、Testing Library

---

### 任务 1：添加失败的品牌资源契约测试

**文件：**
- 创建：`src/components/BrandMark.test.ts`

- [ ] **步骤 1：编写失败的静态契约测试**

创建 `src/components/BrandMark.test.ts`：

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

- [ ] **步骤 2：运行测试并验证因缺少共享资源而失败**

运行：

```powershell
pnpm exec vitest run src/components/BrandMark.test.ts
```

预期结果：FAIL，因为 `public/nexus-logo.svg`、metadata 配置和五个 `BrandMark` 用法尚不存在。

### 任务 2：创建共享 SVG 和 React 品牌组件

**文件：**
- 创建：`public/nexus-logo.svg`
- 创建：`src/components/BrandMark.tsx`

- [ ] **步骤 1：创建几何 SVG 资源**

创建 `public/nexus-logo.svg`：

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" shape-rendering="geometricPrecision">
  <rect width="32" height="32" rx="6" fill="#18181b"/>
  <path d="M8 24V8h4l8 10.67V8h4v16h-4l-8-10.67V24H8Z" fill="#fafafa"/>
</svg>
```

- [ ] **步骤 2：创建装饰性共享组件**

创建 `src/components/BrandMark.tsx`：

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

### 任务 3：替换所有应用内字母徽标并配置 Favicon

**文件：**
- 修改：`src/app/AuthScreen.tsx:15`
- 修改：`src/app/AuthScreen.tsx:228`
- 修改：`src/app/AuthScreen.tsx:423`
- 修改：`src/app/EditorApp.tsx:8`
- 修改：`src/app/EditorApp.tsx:84`
- 修改：`src/app/EditorApp.tsx:104`
- 修改：`src/features/editor/components/WorkspaceSidebar.tsx:10`
- 修改：`src/features/editor/components/WorkspaceSidebar.tsx:165`
- 修改：`src/app/layout.tsx:5`

- [ ] **步骤 1：替换登录页面的标记**

在 `src/app/AuthScreen.tsx` 中导入组件：

```ts
import { BrandMark } from "@/components/BrandMark";
```

将移动端标记替换为：

```tsx
<BrandMark className="size-9" />
```

将桌面端品牌面板标记替换为：

```tsx
<BrandMark className="size-10 shadow-sm" />
```

- [ ] **步骤 2：替换加载和错误状态标记**

在 `src/app/EditorApp.tsx` 中导入 `BrandMark`，然后将加载标记替换为：

```tsx
<BrandMark className="size-10 shadow-sm" />
```

将错误状态标记替换为：

```tsx
<BrandMark className="size-10" />
```

- [ ] **步骤 3：替换工作区侧边栏标记**

在 `src/features/editor/components/WorkspaceSidebar.tsx` 中导入 `BrandMark`，然后将现有的三行 `N` div 替换为：

```tsx
<BrandMark className="size-8 shadow-sm" />
```

- [ ] **步骤 4：将 Next.js metadata 指向共享 SVG**

更新 `src/app/layout.tsx`：

```ts
export const metadata: Metadata = {
  title: "Nexus",
  description: "面向协同办公场景的 Notion 风格块编辑器",
  icons: {
    icon: "/nexus-logo.svg",
  },
};
```

- [ ] **步骤 5：运行契约测试并验证通过**

运行：

```powershell
pnpm exec vitest run src/components/BrandMark.test.ts
```

预期结果：PASS，包含 2 个测试。

### 任务 4：运行回归和视觉验证

**文件：**
- 测试：`src/app/EditorApp.test.tsx`
- 测试：`src/features/editor/components/EditorPage.test.tsx`

- [ ] **步骤 1：运行聚焦组件回归测试**

运行：

```powershell
pnpm exec vitest run src/components/BrandMark.test.ts src/app/EditorApp.test.tsx src/features/editor/components/EditorPage.test.tsx
```

预期结果：所有选定测试均 PASS，且无由 `BrandMark` 引起的警告。

- [ ] **步骤 2：运行 TypeScript 验证**

运行：

```powershell
pnpm exec tsc --noEmit
```

预期结果：退出码为 `0`，无 TypeScript 错误。

- [ ] **步骤 3：启动开发服务器并在浏览器中验证**

在可用端口上运行 `pnpm dev`。使用应用内浏览器检查桌面视口和移动视口。确认：

- `/nexus-logo.svg` 渲染一个非空白的 32px 黑色圆角方形，内含白色几何 `N`。
- 登录页面的桌面和移动端标记使用相同资源，无拉伸或重叠。
- 已认证/本地工作区侧边栏使用 32px 标记，不改变头部对齐。
- 文档头部包含指向 `/nexus-logo.svg` 的图标链接。

- [ ] **步骤 4：运行完整测试套件**

运行：

```powershell
pnpm exec vitest run
```

预期结果：所有测试文件 PASS。

- [ ] **步骤 5：检查并仅提交 Logo 实现文件**

运行：

```powershell
git diff --check
git add public/nexus-logo.svg src/components/BrandMark.tsx src/components/BrandMark.test.ts src/app/layout.tsx src/app/AuthScreen.tsx src/app/EditorApp.tsx src/features/editor/components/WorkspaceSidebar.tsx
git commit -m "feat: add shared Nexus logo and favicon"
```

预期结果：提交排除了现有的 PRD、credential-key、package、lockfile、`.gitignore` 和 `src/shared` 更改。
