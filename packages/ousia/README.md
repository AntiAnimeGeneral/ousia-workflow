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

## 安装语义

- 发布包自带安装源 payload：`.github/instructions/ousia-*.instructions.md`、`.github/skills/**` 及其支持文件、`.ousia/workflow.json`、`.ousia/pending.md` 和 `.ousia/design/*/index.md`。
- `--source <repoRoot>` 可覆盖默认 payload，用于开发 checkout 或 smoke 中模拟下一版安装源。
- 第一版只安装 design index 文件，不安装当前 proposal 正文，避免把本仓库正在执行的计划写进目标项目。
- CLI 按 `.ousia/workflow.json` 的 ownership class 规划安装。
- 写入前先完整规划；如果有 conflict 或 unsupported merge，不写任何文件。
- `ousiaOwned` 文件缺失时创建；如果目标文件与 `.ousia/install-lock.json` 中的上次安装哈希一致，则更新为当前 Ousia 内容；如果目标文件被本地修改或缺少可证明的安装记录，则报 conflict。
- `ousiaStructuredProjectFilled` 文件缺失时创建；如果目标文件与上次安装哈希一致，则更新为当前 Ousia skeleton；内容被本地填充或修改时仍报 unsupported merge；第一版不做 section merge。
- `projectOwned` 和 `localOverrides` 路径不由 installer 改写。

## 验证

```sh
npm --prefix packages/ousia test
npm --prefix packages/ousia run build
npm run release:check
```

`npm run release:check` 会构建、测试、`npm pack`，再用打出的 tarball 做 fresh install、带内容变化的 update、本地修改 conflict 校验；如果存在上一版 tarball，还会用上一版包安装目标目录，再用当前包更新同一目录。更新只会覆盖与 `.ousia/install-lock.json` 中上次安装哈希一致的文件；如果目标文件被本地修改，会报告 conflict 且不写入。

## 当前非目标

- 不发布 npm。
- 不实现完整 section merge。
- 不修改用户全局 agent 配置。
- 不支持 harness plugin 市场安装。
