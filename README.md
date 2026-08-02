# Ousia Workflow

Ousia Workflow 是用于安装和演进 agent-facing 开发工作流的框架。它拥有结构、生命周期、验证规则和 agent reading protocol；项目在 Ousia 定义的 slot 内填充事实。

## 使用

Ousia Workflow 以 Git checkout 分发。目标环境需要安装 Deno 与 Cargo；项目不提供 npm、npx、Node-only、tarball、JSR 或 `deno compile` 兼容分发路径。

拉取 Ousia workflow 仓库并安装本机 CLI：

```sh
git clone <ousia-workflow-repo>
cd ousia-workflow
deno task release
deno task install
```

`deno task install` 先通过 Cargo 默认 install root 安装或更新 `ousia-rust-checker`，验证其 build identity，再安装或更新本机 `ousia` 命令。它可以反复运行；每次运行都会用当前 Git checkout 覆盖更新两个命令。安装后的 `ousia` 默认从这个 Git checkout 读取 workflow source，因此不要删除或移动该 `ousia-workflow/` 目录；需要移动时重新运行 `deno task install`。

首次使用时，需要确保 Cargo 与 Deno 的全局脚本目录都在 `PATH` 中：

```sh
export PATH="$HOME/.cargo/bin:$HOME/.deno/bin:$PATH"
```

安装到目标项目：

```sh
ousia install <target>
```

更新本机 CLI、全局 checker、workflow baseline，并覆盖式更新目标项目：

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
| Framework baseline         | Ousia Workflow     | 随安装分发的四个baseline instructions、entry/domain skills、validation contracts 和 upgrade policy。                            |
| Installed adapter instance | Project            | 已安装的 `.ousia/**` surface，保存项目事实、设计结论、验证命令、references 和约束。                                               |
| Host-owned policy surface  | Project            | Host 项目已有或自建的 agent customization、仓库策略、完成检查和运行偏好；不属于 baseline install surface，也不由 Ousia 规定命名。 |
| Local override             | Project, temporary | 对 framework 的显式偏离。Override 必须说明覆盖的规则和退出条件。                                                                  |

Ousia 项目目录只有一个：`.ousia/**`。它保存已安装的项目事实、设计结论、待处理事项和 overrides。

## 仓库结构

| Path                                                      | Role                                                                           |
| --------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `.github/instructions/ousia-*.instructions.md`            | Framework baseline instructions；会随安装进入目标项目。                        |
| `.github/instructions/ext-ousia-workflow.instructions.md` | 本仓库自己的 self-hosting policy surface；不随 Ousia baseline 安装到目标项目。 |
| `.github/skills/**`                                       | Active entry/domain skills；task mode直接归对应entry skill。                    |
| `src/**`                                                  | Deno installer runtime 和 CLI。                                                |
| `scripts/**`                                              | Deno 执行的 machine bootstrap与identity脚本，用于本机 CLI/checker安装和更新。  |
| `smoke/**/*.ts`                                           | Deno 安装 smoke。                                                              |
| `.github/skills/doc-validation/**`                        | Deno 文档协议 checker；不是 Ousia installer 的 runtime。                       |
| `.github/skills/rust-engineering/checker/**`              | 只在Ousia checkout构建的Cargo checker source；不复制到host baseline。           |
| `.ousia/framework.json`                                   | Framework inventory、project slots、routes、budgets 和 validation contract。   |
| `templates/project/.ousia/**`                             | 安装到未知目标的中性 project-owned seeds。                                     |
| `.ousia/design/**`                                        | 已安装的项目 design facts，按 Architecture、Proposal 和 Experience 组织。      |
| `fixtures/**`                                             | 后续 install 和 upgrade 行为的 smoke fixtures。                                |

## 升级边界

- Ousia-owned files 由 Ousia baseline 更新覆盖，项目用 Git diff 接受、调整或回退。
- Project seed 首次安装时创建，之后 reinstall、update 和 retirement 都逐字 preserve。
- `.ousia/project.json`、pending 和 design slots 完整归项目拥有，不存在共享文件 owner。
- Local overrides 永不静默覆盖，且必须携带退出条件。

Git 是项目接受、调整和回退 baseline 更新的状态 owner。Installer 不做隐式 section merge、managed region 或三方合并；framework assets 按 manifest replace/delete，project facts create-once/preserve。

中心规则是：Ousia Workflow 拥有结构、生命周期、验证和 reading protocol；项目在已安装的 `.ousia/**` adapter instance 内拥有事实。

## 开发与验证

Installer 是 Deno-only CLI。仓库不提供 npm、npx 或 Node-only 兼容入口。

```sh
deno task check
deno task check:workflow
deno task test
deno task smoke:install
deno task release
```

`deno task release` 是 Git 分发质量门，会运行格式、lint、type check、测试和 checkout install smoke。

Agent行为按resolved route、真实workspace、owning skills和验证结果执行。Planning与exploration可由当前Agent或同名subagent承载；review调用当前 checkout 的项目级 `.github/agents/ousia-reviewer.agent.md`，由其 frontmatter 配置模型和取证工具。当前项目使用 `gpt-5.6-luna::dst (oaicopilot)`；该文件通过 `.git/info/exclude` 保持本地，不纳入 Git 或 Ousia installer。配置或故障排查时使用 VS Code Customization Diagnostics；缺失、同名来源冲突或模型不可用时不回退到用户级 agent。仓库不提供独立模型API客户端，也不要求额外API key。

Planner 以 `.ousia/framework.json` 的逐 asset policy 作为行为权威。`ousia check <source>` 验证 manifest、inventory、frontmatter projection、route closure 和 budgets；`ousia install <target>` 支持 dry run。写入阶段使用原子 staging namespace、digest precondition、rollback 和 manifest-last。JSON 输出包含 plan、summary、items、written、deleted、phases 和 diagnostics。

## 故障处理

- `--json` 输出包含 `phase`、`code`、`severity`、`message` 和 `remediation`。
- `apply-parent-blocked` 表示目标父路径被普通文件阻塞，需要调整目标项目路径后重试。
- `apply-target-changed` 表示 plan 后目标路径出现新文件；重新 dry run 并检查 Git diff。
- `apply-recovery-required` 表示 staging 或 journal identity 变化，或出现非本事务拥有的内容；安装器会保留现场，必须人工检查后再清理。
