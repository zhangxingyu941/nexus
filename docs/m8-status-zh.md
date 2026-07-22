# M8 开发状态

更新时间：2026-07-22

总体状态：M8.1A 结构化富文本已完成实现、单元测试和本地定向 E2E；真实 PostgreSQL 与完整协同/匿名分享的发布验收仍待具备完整服务环境后执行。M8.1B、M8.1C、M8.2 和 M8.3 尚未开始。

## M8.1A 结构化富文本

状态：功能实现完成，发布验收待补充

已完成：

- 文本类 Block 使用 `richText JSON + content 纯文本投影` 双字段；段落、标题、引用和待办使用规范化的单段 TipTap/ProseMirror JSON，代码和复杂 Block 固定为 `null`。
- 共享编解码模块白名单校验 marks、mention、hardBreak 和安全链接，限制单块 JSON 为 256 KB；服务端始终从 JSON 重算纯文本投影。
- PostgreSQL 新增可空 `editor_blocks.rich_text JSONB`，保留旧 `content`，以惰性读取和首次合法写入升级旧数据；IndexedDB v2 无需升级 object store。
- 文档、工作区、历史、远程补丁和 Yjs 块内容记录显式携带富文本；协同 fragment 首次按结构化正文种子化，之后不被延迟父快照覆盖。
- 选区工具条支持粗体、斜体、删除线、行内代码、链接和评论；链接使用锚定浮层，拒绝危险协议并支持键盘提交、关闭、打开、复制和移除。
- 外部 HTML 粘贴仅保留受支持行内格式和安全链接，多段内容转为块内换行；Nexus 内部剪贴板可保留完整 mention。
- 匿名快照保留公开格式与安全链接，同时把 mention 降级为普通文本，移除目标 ID 和类型。

## 验证记录

- `pnpm exec tsc --noEmit`：通过。
- `pnpm test --run`：通过。
- `pnpm build`：通过。
- `pnpm exec playwright test e2e/structured-rich-text.spec.ts`：2 项通过，覆盖格式、链接、hardBreak 刷新保留，以及桌面和移动视口的工具条/链接浮层边界；截图由 Playwright 测试产物保存。
- 真实 PostgreSQL 套件未执行：当前环境没有 `TEST_DATABASE_URL`。pg-mem 覆盖仍包含在全量 Vitest 中。
- 交互式浏览器控制接口当前没有可用浏览器实例；已通过 Playwright 截图完成桌面与移动视觉检查。
- 待完整服务环境补充：真实 PostgreSQL、双浏览器 Yjs marks/mention/hardBreak 同步、历史恢复和匿名分享 mention 脱敏的端到端场景。对应的单元、组件和 pg-mem 测试已在全量 Vitest 中执行。

## 后续范围

- M8.1B：多块选择、跨块复制粘贴、批量操作和拖拽增强。
- M8.1C：Markdown 导入导出。
- M8.2：页面树、面包屑、全文搜索和反向链接。
- M8.3：通知中心、未读状态和由 mention 触发的通知。
