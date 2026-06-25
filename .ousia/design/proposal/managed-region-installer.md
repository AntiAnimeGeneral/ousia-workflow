# Managed Region Installer

本提案把 `.ousia/pending.md` 和 `.ousia/design/*/index.md` 从整文件 skeleton 覆盖演进为显式 Ousia managed region 更新。目标是让 Ousia 能更新自己拥有的结构区块，同时保留项目在同一文件里写下的事实、说明和索引补充。

## 目标

- Ousia 只替换显式 marker 包围的 baseline region。
- 项目拥有 marker 外的全部正文和事实。
- Installer 在写入前发现 marker 缺失、重复、嵌套、首尾不匹配或 source/target region 集合不一致。
- Fresh install 仍能创建完整 skeleton。
- Reinstall/update 能保留 marker 外项目内容，并更新 marker 内 baseline 内容。
- Git 继续负责接受、调整和回退最终 diff。

## 非目标

- 不做通用 Markdown merge。
- 不引入 Markdown AST 依赖。
- 不做 install lock、上一版安装数据库、本地编辑追踪或三方合并。
- 不在 `.github/instructions/**`、`.github/skills/**` 或任意项目 Markdown 中启用 region replace。
- 不根据标题猜测插入位置；缺 marker 的既有目标文件直接 conflict。

## 候选方案

- 继续整文件覆盖：实现最简单，但 `.ousia` index 和 pending 文件无法同时承载 Ousia 结构与项目事实，更新 diff 也会过大。
- Markdown AST merge：能理解标题结构，但引入依赖和规则复杂度，且容易把 Ousia 变成隐式文档合并器。
- HTML comment marker：Markdown 渲染不可见，人能读懂，解析范围小，失败语义明确。采用该方案作为第一实施切片。

## 推荐方案

Marker 使用成对 HTML comment：

`<!-- ousia:managed:start id="proposal-current" -->`

`<!-- ousia:managed:end id="proposal-current" -->`

第一版只支持 `id`。Source baseline 和 target 都必须有相同的 region id 集合；每个 id 只能出现一次；region 不能嵌套。Planner 负责把 source region 的完整文本替换到 target 对应 region，marker 外内容保持不变。Applier 只写 planner 已决定的最终 bytes。

## 模块边界

- `.ousia/workflow.json` 声明哪些 ownership class 使用 `replace-managed-regions`。
- `src/manifest.ts` 验证 `replace-managed-regions` 是合法 upgrade policy。
- `src/source.ts` 生成带 marker 的 pending 和 design index skeleton。
- `src/managed_region.ts` 拥有 marker 解析、校验和 region 替换。
- `src/planner.ts` 根据 upgrade policy 决定 create、identical、replace 或 conflict，并把最终待写内容放入 plan item。
- `src/applier.ts` 继续只负责 staging、commit、rollback 和 cleanup。

## 第一实施切片

1. 给 `.ousia/pending.md` 和 `.ousia/design/*/index.md` 的 skeleton 加 marker。
2. 将 `ousiaStructuredProjectFilled` 的 upgrade policy 改为 `replace-managed-regions`。
3. 新增 region parser/replacer。
4. Planner 对 managed-region 文件做最终内容计算。
5. Applier 写入 plan item 的最终内容。
6. 测试 fresh install、reinstall 保留 marker 外正文、source region 更新、malformed marker conflict 和 conflict 后无副作用。

## 失败语义

- Source marker 非法是 source/plan 阶段错误，不进入写入。
- Target marker 非法是 plan conflict，不进入 apply。
- 已存在 target 缺少 marker 是 conflict，不猜测插入位置。
- Region id 集合不一致是 conflict，要求用户先用 Git 检查并调整目标文件。

## 验证

- `deno task release`
- `deno task --cwd .github/skills/doc-validation check:docs`
- `git diff --check -- .ousia .github README.md src test deno.json`
- 临时目标 smoke：安装、在 marker 外追加项目文字、重新安装并确认 marker 外文字保留。

## Review Focus

- Marker parser 是否只支持声明的最小语法，且失败前置。
- Planner 是否是 merge 决策 owner，applier 是否没有读取目标文件或解析 marker。
- Managed region 是否只由 manifest policy 启用，没有扩散到任意 Markdown。
- 测试是否通过真实 install 路径证明 marker 外项目内容保留。
- 文档是否把该能力描述为显式 region replace，而不是通用合并或用户编辑保护。