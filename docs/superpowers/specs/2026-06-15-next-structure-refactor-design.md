# Next 结构重构设计

## 目标

整理当前 Next.js App Router 项目结构，把迁移中的 Vite/Next 混合状态收敛为 `src/app` + 功能模块结构，并拆分编辑器中体量过大的组件和纯函数模块。

## 参考

- Next.js `src` 目录约定：`app` 可以移动到 `src/app`；如果根目录 `app` 和 `src/app` 同时存在，根目录 `app` 优先。
- Next.js App Router 组织方式：允许文件共置，但私有目录和功能边界有助于保持路由代码聚焦。

## 架构

- 路由层位于 `src/app`。
- 功能代码保留在 `src/features/editor`。
- 仅服务端使用的工作区存储保留在 `src/server`。
- `src/app/page.tsx` 通过小型客户端边界组件直接渲染编辑器页面，不再保留 Vite 时代的 `src/App.tsx` 包装组件。
- 模型文件通过统一出口保持稳定公开导出，内部实现按职责拆分。

## 组件边界

- `WorkspaceSidebar.tsx` 仍是公开侧边栏组件，并把文档列表、模板弹窗、搜索弹窗、任务中心、动态面板和协作者面板委托给 `src/features/editor/components/sidebar` 下的聚焦文件。
- `DocumentEditor.tsx` 仍是公开编辑器壳，并把标题/页头、评论/历史/分享/成员面板委托给 `src/features/editor/components/document` 下的聚焦文件。
- `BlockRow.tsx` 仍是公开块行组件，并把块控制、斜杠菜单、协作属性弹窗和评论弹窗委托给 `src/features/editor/components/blocks` 下的聚焦文件。

## 模型边界

- 文档模板和文档创建逻辑放在文档创建模块。
- 块变更逻辑放在块操作模块。
- 工作区 CRUD/选择逻辑放在工作区文档模块。
- 工作区派生数据、搜索、任务、协作者和活动放在查询模块。
- 规范化和持久化数据载荷修复逻辑放在规范化模块。
- 通过统一出口文件保持现有导入路径可用，减少改动面。

## 验证

- 运行 `npm test -- --run`。
- 运行 `npm run build`。
- 如果出现失败，先诊断根因再修补。
