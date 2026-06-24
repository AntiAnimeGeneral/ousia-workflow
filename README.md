# Ousia Workflow

Ousia Workflow 是用于安装和演进 agent-facing 开发工作流的框架。它拥有结构、生命周期、验证规则和 agent reading protocol；项目在 Ousia 定义的 slot 内填充事实。

## 模型

| Layer                      | Owner              | Role                                                                                                                              |
| -------------------------- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| Framework baseline         | Ousia Workflow     | 随安装分发的 `ousia-*` instructions、facade skills、shared task modes、validation contracts 和 upgrade policy。                   |
| Installed adapter instance | Project            | 已安装的 `.ousia/**` surface，保存项目事实、设计结论、验证命令、references 和约束。                                               |
| Host-owned policy surface  | Project            | Host 项目已有或自建的 agent customization、仓库策略、完成检查和运行偏好；不属于 baseline install surface，也不由 Ousia 规定命名。 |
| Local override             | Project, temporary | 对 framework 的显式偏离。Override 必须说明覆盖的规则和退出条件。                                                                  |

Ousia 项目目录只有一个：`.ousia/**`。它保存已安装的项目事实、设计结论、待处理事项和 overrides。

## 仓库结构

| Path                                                      | Role                                                                           |
| --------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `.github/instructions/ousia-*.instructions.md`            | Framework baseline instructions；会随安装进入目标项目。                        |
| `.github/instructions/ext-ousia-workflow.instructions.md` | 本仓库自己的 self-hosting policy surface；不随 Ousia baseline 安装到目标项目。 |
| `.github/skills/**`                                       | Active framework skills 和 shared mode components。                            |
| `src/**`                                                   | Deno installer runtime 和 CLI。                                                |
| `scripts/**`                                               | Deno 执行的 TypeScript 安装脚本，用于本机 CLI 安装和更新。                    |
| `smoke/**/*.ts`                                            | Deno 安装 smoke 和 release smoke。                                             |
| `.github/skills/doc-validation/**`                        | Deno 文档协议 checker；不是 Ousia installer 的 runtime。                       |
| `.ousia/workflow.json`                                    | Ownership 和 upgrade policy 的 manifest。                                      |
| `.ousia/design/**`                                        | 已安装的项目 design facts，按 Architecture、Proposal 和 Experience 组织。      |
| `fixtures/**`                                             | 后续 install 和 upgrade 行为的 smoke fixtures。                                |

## 升级边界

- Ousia-owned files 由 Ousia baseline 更新覆盖，项目用 Git diff 接受、调整或回退。
- Ousia-structured/project-filled baseline skeleton 由 Ousia baseline 更新覆盖；项目事实应保存在 Ousia 定义的 owning sources 中，或通过 Git 调整。
- Project-owned files 只路由和验证，默认不改写。
- Local overrides 永不静默覆盖，且必须携带退出条件。

Git 是项目接受、调整和回退 baseline 更新的状态 owner。Installer 不记录上一版安装状态，不判断用户是否修改过 baseline 文件，不维护 install lock，也不做 section merge 或三方合并。

中心规则是：Ousia Workflow 拥有结构、生命周期、验证和 reading protocol；项目在已安装的 `.ousia/**` adapter instance 内拥有事实。

## Installer 开发

Installer 是 Deno-only CLI。仓库不提供 npm、npx 或 Node-only 兼容入口。

```sh
deno task check
deno task test
deno task smoke:install
deno task release
```

对目标项目做 dry run：

```sh
deno task install
ousia install <target> --dry-run
```

默认安装源是安装 CLI 时所在的 Ousia Git checkout。`deno task release` 是 Git 分发质量门，会运行格式、lint、type check、测试和 checkout install smoke。更新 Ousia 时，用户 `git pull` 后重新运行 `deno task install`，再在目标项目执行 `ousia install .` 覆盖更新 workflow baseline。

发布和安装使用说明见 [release-and-install.md](./docs/release-and-install.md)。

Planner 以 `.ousia/workflow.json` 的 `upgradePolicy` 作为行为权威。写入阶段使用 staging 和 rollback-backed journal；可前置发现的路径阻塞会在写入前失败，commit 中途失败会尝试恢复已替换文件并清理 staging。CI 或脚本集成可以追加 `--json` 获取 stable plan、summary、items、written 和 phases；每个 item 携带 ownership、matched pattern、upgrade policy 和自己的 diagnostic。失败 JSON 输出包含 phase、code、severity、message 和 remediation。
