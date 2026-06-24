# Ousia Release Installer

本提案定义 TypeScript release 项目的第一实施切片：在当前仓库内新增 `packages/ousia/`，提供能把 Ousia workflow 安装到目标项目的 CLI。

## 目标

- 提供 `ousia install <target>`，把 active workflow surface 安装到目标项目。
- 发布包自带 workflow payload；开发和测试可用 `--source <repoRoot>` 覆盖安装源。
- 安装器按 `.ousia/workflow.json` 的 ownership policy 做规划。
- Fresh install 能创建 `.github/instructions/ousia-*.instructions.md`、`.github/skills/**` 及其支持文件和 `.ousia/**` skeleton。
- Ousia baseline 更新时直接覆盖目标 baseline 文件；用户通过 Git diff 决定接受、调整或回退。
- Installer 只负责守住 baseline、project-owned、local override 边界，不复制 Git 的变更接受/回退职责。
- CLI 提供 `--json` 输出，供公司项目 CI 读取 stable diagnostics 和 plan summary。
- 失败路径在写入前完成可前置阻塞检查；写入阶段使用 staging 和 rollback-backed journal，commit 失败时恢复已替换文件并清理 staging。普通文件系统没有真正的多文件原子事务，rollback failure 必须暴露稳定诊断。

## 非目标

- 不发布 npm。
- 不实现完整 section merge。
- 不实现 install lock、上一版安装数据库或本地编辑追踪；项目 Git 拥有接受、调整和回退 baseline 更新的状态。
- 不把主发行物整体 Deno 化；Node/npm CLI 是用户安装契约，Deno 只作为 doc-validation checker runtime。
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
- `scripts/prepare-package-payload.mjs` 在 build/prepack 时把可安装 workflow surface 复制到 `dist/payload`，使 tarball 不依赖外部 checkout 也能安装。
- `manifest` 解析 `.ousia/workflow.json`，拥有 ownership class、matched pattern 和 upgrade policy 判断。
- `planner` 只负责比较 source 和 target，按 manifest upgrade policy 输出 create、identical、replace、skip 或真正无策略时的 conflict。
- `applier` 拥有 staging、journal、commit、rollback 和 apply diagnostics，是唯一文件写入副作用 owner。
- `installer` 编排 source、plan、dry-run、blocked、apply 和 report；有阻塞时不写文件。
- `cli` 只负责参数解析、调用 installer 和输出摘要。

## 第一实施切片

1. 创建 `packages/ousia/` TypeScript package。
2. 实现 source snapshot、manifest、planner、installer 和 CLI。
3. 用临时目录测试 fresh install、dry run、重复安装、baseline overwrite、project/local override 边界、policy-driven plan、apply preflight failure 和 rollback。
4. 文档说明第一版不做 section merge。

## 验证

- `npm --prefix packages/ousia test`
- `npm --prefix packages/ousia run build`
- `npm run release:check`
- `deno task --cwd .github/skills/doc-validation check:docs`
- `git diff --check -- .github .ousia README.md packages fixtures`

## Review Focus

- Installer 是否把 ownership policy 当成单一权威，而不是在 CLI 中散落覆盖规则。
- Planner 是否先完整发现冲突，再允许 installer 写入。
- Applier 是否真的能在 preflight 失败时不写入，并在 commit 失败时恢复已替换文件。
- JSON error 是否暴露 stable phase、code、severity、message 和 remediation。
- JSON 输出是否能支持 CI 集成而不依赖 grep 人类文本。
- Baseline 覆盖是否只发生在 source snapshot 和 manifest ownership 覆盖的 Ousia baseline 路径内。
- Project-owned 和 local override 边界是否不会被 installer 改写。
- Source snapshot 是否只包含可安装 workflow surface，没有混入当前项目临时 proposal 正文。
- 测试是否覆盖 failure no-side-effect，而不是只覆盖 fresh install happy path。
