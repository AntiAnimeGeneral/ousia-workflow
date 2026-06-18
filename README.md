# Ousia Workflow

Ousia Workflow 是用于安装和演进 agent-facing 开发工作流的框架。它拥有结构、生命周期、验证规则和 agent reading protocol；项目在 Ousia 定义的 slot 内填充事实。

## 模型

| Layer            | Owner              | Role                                                                                          |
| ---------------- | ------------------ | --------------------------------------------------------------------------------------------- |
| Framework core   | Ousia Workflow     | Base instructions、facade skills、shared task modes、validation contracts 和 upgrade policy。 |
| Adapter instance | Project            | 已安装的 `.ousia/**` surface，保存项目事实、设计结论、验证命令、references 和约束。           |
| Local override   | Project, temporary | 对 framework 的显式偏离。Override 必须说明覆盖的规则和退出条件。                              |

Ousia 项目目录只有一个：`.ousia/**`。它保存已安装的项目事实、设计结论、待处理事项和 overrides。

## 仓库结构

| Path                                                      | Role                                                                      |
| --------------------------------------------------------- | ------------------------------------------------------------------------- |
| `.github/instructions/ousia-*.instructions.md`            | 本仓库 agent 使用的 active framework instructions。                       |
| `.github/instructions/ext-ousia-workflow.instructions.md` | 本 workflow 项目的 active repository policy。                             |
| `.github/skills/**`                                       | Active framework skills 和 shared mode components。                       |
| `packages/ousia/**`                                       | TypeScript release installer，用于把 Ousia workflow 安装到目标项目。      |
| `.ousia/workflow.json`                                    | Ownership 和 upgrade policy 的 manifest。                                 |
| `.ousia/design/**`                                        | 已安装的项目 design facts，按 Architecture、Proposal 和 Experience 组织。 |
| `fixtures/**`                                             | 后续 install 和 upgrade 行为的 smoke fixtures。                           |

## 升级边界

- Ousia-owned files 未修改时可由 upgrade tooling 替换。
- Ousia-structured/project-filled files 按稳定 section 合并，并保留项目内容。
- Project-owned files 只路由和验证，默认不改写。
- Local overrides 永不静默覆盖，且必须携带退出条件。

中心规则是：Ousia Workflow 拥有结构、生命周期、验证和 reading protocol；项目在已安装的 `.ousia/**` adapter instance 内拥有事实。

## Installer 开发

构建和测试 TypeScript installer：

```sh
npm --prefix packages/ousia test
npm --prefix packages/ousia run build
```

对目标项目做 dry run：

```sh
node packages/ousia/dist/src/cli.js install <target> --source . --dry-run
```
