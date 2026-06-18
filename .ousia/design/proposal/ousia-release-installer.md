# Ousia Release Installer

本提案定义 TypeScript release 项目的第一实施切片：在当前仓库内新增 `packages/ousia/`，提供能把 Ousia workflow 安装到目标项目的 CLI。

## 目标

- 提供 `ousia install <target>`，把 active workflow surface 安装到目标项目。
- 安装器按 `.ousia/workflow.json` 的 ownership policy 做规划。
- Fresh install 能创建 `.github/instructions/ousia-*.instructions.md`、`.github/skills/**` 及其支持文件和 `.ousia/**` skeleton。
- 重复安装或 upgrade 遇到用户改动时报告 conflict，不静默覆盖。
- 失败路径在写入前完成所有阻塞检查，保证没有部分状态。

## 非目标

- 不发布 npm。
- 不实现完整 section merge。
- 不支持 harness plugin 市场安装。
- 不修改用户全局 agent 配置。
- 不把当前仓库重排成最终 `core/**` 目录。

## 候选方案

- 直接重排为最终 `core/**` 包：接近长期形态，但会把安装器和 workflow extraction 迁移绑在一起，第一切片过大。
- 只写 shell installer：实现快，但 ownership、失败无副作用和测试边界会散落，难以演进。
- 当前推荐方案：在 `packages/ousia/` 建 TypeScript CLI，先从当前 active surface 生成安装源，后续再切换到 `core/**` source manifest。

## 模块边界

- `source` 读取安装源文件，并产生 source snapshot。
- Source snapshot 只安装 design index 文件，不安装当前 proposal 正文，避免把本仓库临时执行路线写入目标项目。
- `manifest` 解析 `.ousia/workflow.json`，拥有 ownership class 和 policy 判断。
- `planner` 只负责比较 source 和 target，输出 create、identical、conflict 或 unsupported merge。
- `installer` 只执行无阻塞 plan；有阻塞时不写文件。
- `cli` 只负责参数解析、调用 installer 和输出摘要。

## 第一实施切片

1. 创建 `packages/ousia/` TypeScript package。
2. 实现 source snapshot、manifest、planner、installer 和 CLI。
3. 用 `fixtures/minimal-project/` 和临时目录测试 fresh install、dry run、重复安装和 conflict-safe reinstall。
4. 文档说明第一版不做 section merge。

## 验证

- `npm --prefix packages/ousia test`
- `npm --prefix packages/ousia run build`
- `deno task --cwd .github/skills/doc-validation check:docs`
- `git diff --check -- .github .ousia README.md packages fixtures`

## Review Focus

- Installer 是否把 ownership policy 当成单一权威，而不是在 CLI 中散落覆盖规则。
- Planner 是否先完整发现冲突，再允许 installer 写入。
- Source snapshot 是否只包含可安装 workflow surface，没有混入当前项目临时 proposal 正文。
- 测试是否覆盖 failure no-side-effect，而不是只覆盖 fresh install happy path。