# Ousia Workflow

Ousia Workflow 是用于安装和演进 agent-facing 开发工作流的框架。它拥有结构、生命周期、验证规则和 agent reading protocol；项目在 Ousia 定义的 slot 内填充事实。

## 使用

Ousia Workflow 以 Git checkout 分发。目标环境需要安装 Deno；项目不提供 npm、npx、Node-only、tarball、JSR 或 `deno compile` 兼容分发路径。

拉取 Ousia workflow 仓库并安装本机 CLI：

```sh
git clone <ousia-workflow-repo>
cd ousia-workflow
deno task release
deno task install
```

`deno task install` 会安装或更新本机 `ousia` 命令，并封装 Deno config、权限和命令名。它可以反复运行；每次运行都会用当前 Git checkout 覆盖更新本机命令。安装后的 `ousia` 默认从这个 Git checkout 读取 workflow source，因此不要删除或移动该 `ousia-workflow/` 目录；需要移动时重新运行 `deno task install`。

首次使用时，需要确保 Deno 的全局脚本目录在 `PATH` 中：

```sh
export PATH="$HOME/.deno/bin:$PATH"
```

安装到目标项目：

```sh
ousia install <target>
```

更新本机 CLI、workflow baseline，并覆盖式更新目标项目：

```sh
cd ousia-workflow
git pull
deno task release
deno task install
cd /path/to/target-project
ousia install .
```

目标项目用自己的 Git diff 接受、调整或回退 Ousia baseline 更新：

```sh
git diff
```

需要预览安装计划时：

```sh
ousia install <target> --dry-run
ousia install <target> --dry-run --json
```

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
| `smoke/**/*.ts`                                            | Deno 安装 smoke。                                                              |
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

## 开发与验证

Installer 是 Deno-only CLI。仓库不提供 npm、npx 或 Node-only 兼容入口。

```sh
deno task check
deno task test
deno task smoke:install
deno task release
```

`deno task release` 是 Git 分发质量门，会运行格式、lint、type check、测试和 checkout install smoke。

Planner 以 `.ousia/workflow.json` 的 `upgradePolicy` 作为行为权威。写入阶段使用 staging 和 rollback-backed journal；可前置发现的路径阻塞会在写入前失败，commit 中途失败会尝试恢复已替换文件并清理 staging。CI 或脚本集成可以追加 `--json` 获取 stable plan、summary、items、written 和 phases；每个 item 携带 ownership、matched pattern、upgrade policy 和自己的 diagnostic。失败 JSON 输出包含 phase、code、severity、message 和 remediation。

## 故障处理

- `--json` 输出包含 `phase`、`code`、`severity`、`message` 和 `remediation`。
- `apply-parent-blocked` 表示目标父路径被普通文件阻塞，需要调整目标项目路径后重试。
- `apply-target-changed` 表示 plan 后目标路径出现新文件；重新 dry run 并检查 Git diff。
- `apply-rollback-failed` 表示回滚也失败，必须用目标项目 Git diff 检查并手动恢复。
