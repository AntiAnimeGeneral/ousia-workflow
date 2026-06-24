# Ousia Installer

`@ousia/workflow` 是 Ousia Workflow 的 TypeScript release 项目。第一版提供 `ousia install` CLI，把当前 Ousia workflow surface 安装到目标项目。

## 命令

```sh
npm --prefix packages/ousia run build
node packages/ousia/dist/src/cli.js install <target>
```

Dry run：

```sh
node packages/ousia/dist/src/cli.js install <target> --dry-run
```

默认安装源是发布包内的 `dist/payload`。开发或测试本地 checkout 时，可以用 `--source <repoRoot>` 覆盖安装源。
CI 或脚本集成可以追加 `--json`，输出 stable plan、summary、diagnostics、items、written 和 phases。

## 安装语义

- 发布包自带安装源 payload：`.github/instructions/ousia-*.instructions.md`、`.github/skills/**` 及其支持文件、`.ousia/workflow.json`、`.ousia/pending.md` 和 `.ousia/design/*/index.md`。
- `--source <repoRoot>` 可覆盖默认 payload，用于开发 checkout 或 smoke 中模拟下一版安装源。
- 第一版只安装 design index 文件，不安装当前 proposal 正文，避免把本仓库正在执行的计划写进目标项目。
- CLI 按 `.ousia/workflow.json` 的 ownership class 规划安装。
- 写入前先完整规划；如果 source snapshot 中出现没有可执行 ownership 策略的路径，不写任何文件。
- `ousiaOwned` 和 `ousiaStructuredProjectFilled` 文件缺失时创建，存在且内容不同时直接用当前 Ousia baseline 覆盖。用户通过 Git 决定接受、调整或回退这些 baseline 更新。
- `projectOwned` 和 `localOverrides` 路径不由 installer 改写。

## 验证

```sh
npm --prefix packages/ousia test
npm --prefix packages/ousia run build
npm run release:check
```

`npm run release:check` 会构建、测试、`npm pack`，再用打出的 tarball 做 fresh install、带内容变化的 update、baseline overwrite 校验，并要求存在上一版 tarball 来测试上一版目录更新。非正式 smoke 可设置 `OUSIA_RELEASE_ALLOW_MISSING_PREVIOUS=1` 跳过上一版包检查。

## 当前非目标

- 不发布 npm。
- 不实现 section merge；baseline 更新直接覆盖，项目用 Git 接受或回退。
- 不修改用户全局 agent 配置。
- 不支持 harness plugin 市场安装。
