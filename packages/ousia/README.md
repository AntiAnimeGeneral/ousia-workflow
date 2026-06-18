# Ousia Installer

`@ousia/workflow` 是 Ousia Workflow 的 TypeScript release 项目。第一版提供 `ousia install` CLI，把当前 Ousia workflow surface 安装到目标项目。

## 命令

```sh
npm --prefix packages/ousia run build
node packages/ousia/dist/src/cli.js install <target> --source .
```

Dry run：

```sh
node packages/ousia/dist/src/cli.js install <target> --source . --dry-run
```

## 安装语义

- 安装源来自当前仓库的 active workflow surface：`.github/instructions/ousia-*.instructions.md`、`.github/skills/**` 及其支持文件、`.ousia/workflow.json`、`.ousia/index.md`、`.ousia/pending.md` 和 `.ousia/design/**/index.md`。
- 第一版只安装 design index 文件，不安装当前 proposal 正文，避免把本仓库正在执行的计划写进目标项目。
- CLI 按 `.ousia/workflow.json` 的 ownership class 规划安装。
- 写入前先完整规划；如果有 conflict 或 unsupported merge，不写任何文件。
- `ousiaOwned` 文件缺失时创建，内容不同时报 conflict。
- `ousiaStructuredProjectFilled` 文件缺失时创建，内容不同时报 unsupported merge；第一版不做 section merge。
- `projectOwned` 和 `localOverrides` 路径不由 installer 改写。

## 验证

```sh
npm --prefix packages/ousia test
npm --prefix packages/ousia run build
```

## 当前非目标

- 不发布 npm。
- 不实现完整 section merge。
- 不修改用户全局 agent 配置。
- 不支持 harness plugin 市场安装。
