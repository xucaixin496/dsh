# 上游升级流程（把 deepseek-harness 官方版本合入本 fork）

记录把上游 `deepseek-ai/deepseek-harness` 新版本合入本 fork 的可复现流程，
以及 0.1.0-rc.5 到 0.1.0-rc.7 这次升级遇到的全部坑。下次官方发版按本文档执行。

## 背景事实

- fork 根提交是上游快照（无共同 git 祖先），不能用 merge-base 常规合并。
- 桌面更新器用 `git pull --ff-only`，合并后 master 必须保持旧历史为第一父。
- fork 独有功能（通用文件附件、扫描 PDF OCR、原地重生成、插件商店、更新器）上游没有，
  合并是"重放我们的增量"，不是功能冲突。

## 复现步骤

1. 留回滚点：`git tag -a pre-<version>-update -m ... HEAD`。
2. 取上游 tag：`git fetch <upstream> +refs/tags/dsh-v<version>:refs/remotes/upstream-tmp/next`。
3. 建分支：`git checkout -b update-<version> upstream-tmp/next`。
4. 生成增量并三路重放：`git diff --binary --output=ours.patch <baseline> HEAD`，`git apply --3way ours.patch`。
5. 解决冲突后依赖对齐：`pnpm install --no-frozen-lockfile`（PATH 需含 node 目录；CI=true；
   `npm_config_confirm_modules_purge=false`；registry 用 npmmirror；store-dir 用 research/.pnpm-store）。
6. 验证：host/client 全量 tsc；跑自定义功能与上游相关测试；重新生成全部目录；
   构建 host/client bundle 与 web shell（apps/web 的 vite build）。
7. 双亲合并回 master：`git merge --no-commit --no-ff --allow-unrelated-histories update-<version>`，
   然后 `git read-tree -u --reset update-<version>`，再 `git commit`。
8. 推送 origin master；重打安装包；跑安装包冒烟与清理。

## 常见冲突点（rc.7 实测）

- `attachment/attachment/src/index.ts`：我们加文件缝隙，上游加 saveImages 批量助手。
  两边都保留；文件方法给具象默认实现（抛 FILE_STORAGE_UNSUPPORTED），
  让上游仅图片的 store 和测试双无需改动即可编译。
- `attachment/attachment/src/error.ts`：把我们的文件错误码并入 AttachmentErrorCode 联合。
- `host/apiproxy/src/api-proxy.ts`：上游重构 durablePromptContent 为 saveImages，
  并删除 settings 命名空间白名单。合并版：图片走 saveImages，文件保留我们的
  saveFile + extractFileText；删除已死的 PRODUCT_SETTINGS_NAMESPACES；
  regenerate、beforeTurnSeq、插件商店、更新路由重放。
- `llm/llm-pi-ai/src/context.ts`、`adapter.ts`：上游加 ReplayEnvelope 的
  onReplayDegrade 参数线程，区域不重叠，我们的文件投影补丁直接叠加。
- `client/ui-settings-plugins`：上游把 settings.plugin.item 从 list 改为 keyed，
  商店 tab 保留，测试断言跟随上游。
- 测试/脚本里的 AttachmentStore 子类：文件方法改具象后需给成员加 override 修饰符。
- `scripts/gen-cordis-catalog.ts`：在 LINK_MAP 登记 FileAttachmentRef、
  SaveFileAttachment、StoredFileAttachment。
- pnpm-lock/pnpm-workspace：取上游 lock 后 pnpm install 重新对齐。
- `packages/host/webserver/src/index.js*`：历史上误提交的构建产物，合并时剔除。

## 陷阱清单

1. 不用 `git pull upstream`：无共同祖先会得到全树 add/add 冲突。
2. 合并提交第一父必须是旧 master，否则已安装副本的 pull --ff-only 失败。
3. pnpm 需要 node 在 PATH，否则 node-pty 等 install 脚本报找不到 node。
4. patchedDependencies 变化时 pnpm 要求 --no-frozen-lockfile，可能清空 node_modules，属预期。
5. 上游内部 API 会变（ReplayEnvelope、saveImages、settings 表面重构），
   编译错要逐个修，不是合并工具问题。
6. 目录生成器有 JSDoc 强校验：默认方法参数改名 _input/_ref/_signal 时，
   @param 必须同步改名。
7. 生成产物（slot-catalog、tool-catalog、cordis-catalog、known-event-types、
   scoped-events、module-graph、config-catalog）合并后必须重新生成并提交。
8. 安装包会显著变大（上游源码 + OCR 训练数据），冒烟必须重跑。
