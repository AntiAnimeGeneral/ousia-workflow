# 08 项目级 Reviewer 配置

## 状态

- Mode：`refactor`
- Target：`product`
- Compatibility：`required`
- 状态：已实施并通过 focused implementation review

## 关闭结论

采用 workspace `.github/agents` + clone-local ignore。当前 checkout 的 host-owned agent 使用 `gpt-5.6-luna::dst (oaicopilot)`，已知旧 workspace 与 user-level 同名来源已删除，canonical 文件未被 Git 跟踪且由 `.git/info/exclude` 忽略。Baseline 只保存跨项目调用协议，当前模型继续由 self-host policy、项目 agent 和项目 design facts 拥有。

`git diff --check`、`git diff --check -- .ousia`、文档检查和 `deno task check:workflow` 均通过；项目级 agent 真实启动并报告目标模型、受限工具和项目文件读取能力。Focused implementation review 的唯一 blocking finding 是 baseline 曾携带 self-host 精确模型；修复后复审输出“未发现需要阻塞合入的问题”。未能通过可编程 Diagnostics 枚举 parent 或 organization 来源，继续作为宿主配置排查时的 residual risk；`execute` 的只读取证边界仍依赖 agent 指令，不是机械权限隔离。

## 用户目标

`Ousia Reviewer` 不应是所有项目共用的一份全局配置。当前 checkout 使用 `gpt-5.6-luna::dst (oaicopilot)`，并允许每位用户在其他项目中独立配置 reviewer 的模型、工具和项目补充说明；配置只属于当前用户在当前项目的本地 checkout，不提交团队 Git，也不改变 Ousia review 语义的唯一 owner。

## 当前边界

当前 workflow instruction 要求 review 调用用户级 `Ousia Reviewer`，其 frontmatter 的 `model` 是模型配置权威。这个位置适合跨项目复用，但不能表达“用户 × 项目”的独立配置。VS Code 原生支持 workspace `.github/agents` 和 user `~/.copilot/agents` 两种 custom agent 位置；workspace agent 会随当前 workspace 被发现，适合把项目边界交给当前 checkout，而不需要新的路径设置。

Ousia 不拥有 VS Code custom agent runtime，也不应把 provider、model、工具或个人 prompt 写入 `.ousia/framework.json`、`.ousia/project.json` 或 installer inventory。review 的 subject、mode、scope、materiality、strictness、blocking、输出格式、复审边界和 stop condition 继续由 `.github/skills/black-team-review/SKILL.md` 拥有。

## 目标与非目标

目标：

1. 让当前项目使用 `.github/agents/ousia-reviewer.agent.md` 作为 `Ousia Reviewer` 的本地执行载体。
2. 当前 checkout 固定使用 `gpt-5.6-luna::dst (oaicopilot)`；其他 checkout 可以独立选择模型、工具和项目专用补充说明。
3. 让本地文件通过 clone-local ignore 留在个人环境，不成为团队共享配置或 Ousia install asset。
4. 缺少、重复或无效的项目级 reviewer 配置时显式停止，不静默回退到全局 reviewer。
5. 保持 review 语义、project facts、route matrix、validation contract 和 installer ownership 不变。

非目标：

- 不在 Framework Manifest 或 project facts 中保存 provider、model、工具列表或 agent 路径。
- 不创建第二套 review severity、blocking、输出或 stop condition 规则。
- 不把个人配置作为 `.github/agents` 的团队共享 baseline 分发。
- 不实现新的模型 API、凭证管理、agent registry 或 VS Code discovery 机制。
- 不修改 `black-team-review` 的 review 语义。

## 候选方案

### 方案 A：workspace `.github/agents` + clone-local ignore（采用）

每个用户在每个项目的 `.github/agents/ousia-reviewer.agent.md` 中保存自己的配置，并通过当前 clone 的 `.git/info/exclude` 忽略该文件。文件保留精确的 `name: Ousia Reviewer`；当前 checkout 的模型固定为 `gpt-5.6-luna::dst (oaicopilot)`，其他 checkout 的模型、工具和补充说明可以按项目变化。

优点是使用 VS Code 原生 workspace discovery，不引入额外设置；本地文件天然与项目 root 绑定；Ousia installer 不在 manifest 中声明它，因此 install、update 和 retirement 不会接管它。代价是每个用户需要为每个项目创建配置和 local exclude。

### 方案 B：`.ousia/local/agents` + `chat.agentFilesLocations`

将个人 agent 放到 `.ousia` 下，再使用 VS Code `chat.agentFilesLocations` 扫描。这个方案可以实现本地隔离，但会在 Ousia skeleton/facts 之外引入隐藏的 prompt surface 和额外 settings 协议；还需要定义 local path、workspace settings、升级保护和诊断边界，收益不足以抵消新的 owner 混淆，因此不采用。

### 方案 C：继续使用 user `~/.copilot/agents`，用名称或 fallback 区分项目

这种方案无法保证项目隔离；同名 agent 的解析优先级依赖宿主行为，项目名称也不能安全地作为 Ousia route discriminator。它会把项目选择逻辑放到 runtime 隐式 fallback 中，因此不采用。

## 推荐设计

### 配置 owner

- `.github/skills/black-team-review/SKILL.md`：review 语义和输出合同的唯一 owner。
- `.github/instructions/ousia-workflow.instructions.md`：所有宿主项目的 review 执行载体选择和调用协议。
- `.github/instructions/ext-ousia-workflow.instructions.md`：本仓库 self-host 的配置失败、安装边界和迁移策略。
- `.github/agents/ousia-reviewer.agent.md`：当前 checkout 的运行时 agent 配置；拥有个人 model、tools 和补充 prompt，但不拥有 review 协议。
- VS Code Customization Diagnostics：宿主 frontmatter、可用 model、加载来源和重复 agent 的运行时证据 owner。
- `.ousia/framework.json`：保持不变；不记录 agent、model、provider 或个人路径。

### Project identity 与来源证据

当前切片只支持一个明确的 Ousia project root：VS Code 当前唯一 workspace folder，且该目录直接包含 `.ousia/framework.json`。Git root 只用于判断 local ignore 和 host 文件生命周期，不参与 project identity。不能从 parent、child 或同一 workspace 外的其他项目猜测 root。

项目级 reviewer 使用 VS Code 原生 workspace custom agent discovery。Ousia 不实现 agent registry，也不声称拥有 custom agent 实例化前可调用的来源诊断 API。配置、迁移或故障排查时使用 VS Code Customization Diagnostics 确认当前 workspace 文件已加载、模型可用且没有同名 user、parent、organization 或其他 workspace 来源；普通 review 调用依赖这份已建立的本地配置，不生成无法由宿主验证的 fingerprint 或 handoff 协议。

如果当前宿主不能提供 Diagnostics，调用方仍可检查单根 workspace、本地文件和已知 user-level 文件，但必须把未覆盖的 parent、organization 或宿主来源列为 residual risk，不得声称已机械证明唯一来源。发现任何已知同名来源时停止 review，不依赖未文档化的优先级。

### 查找与失败语义

项目级 reviewer 不依赖 workspace/user scope 的宿主优先级：

1. 当前 review 必须运行在单根 workspace 中；唯一 workspace root 是目标项目根，并且该根直接包含 `.ousia/framework.json`。多根 workspace、仅打开嵌套子目录、或同时发现 parent-repository customizations 时，停止 review，不临时选择一个 root。
2. 在该 workspace root 查找 `.github/agents/ousia-reviewer.agent.md`。该文件必须声明精确名称 `Ousia Reviewer`，且 frontmatter 可被宿主解析。
3. 配置、迁移或来源异常时，用 VS Code Customization Diagnostics 检查 workspace 文件是否加载、模型是否可用以及是否存在同名来源；发现重复来源时停止，不假设宿主优先级。
4. 调用不传 tool-level `model`，由当前 workspace agent 的 frontmatter 选择模型。
5. 缺少文件、名称不匹配、frontmatter 无效、来源重复、workspace 拓扑不支持或模型不可用时，按以下 code 停止 review，并给出 remediation；即使 user scope 存在可用同名 agent，也不得 fallback：
	- `reviewer-project-missing`：当前项目没有本地 agent。
	- `reviewer-source-ambiguous`：发现多个同名来源或不支持的 workspace/parent scope。
	- `reviewer-config-invalid`：frontmatter 或必需字段不符合契约。
	- `reviewer-tool-boundary-invalid`：工具集合包含 edit、create、delete、agent、MCP 或其他写入、嵌套代理能力。
	- `reviewer-model-unavailable`：宿主不能启动 frontmatter 声明的精确 model。
6. 不把项目级 agent 文件写入 Ousia inventory；installer 对未声明的 host-owned 文件保持不触碰。

### Agent 文件边界

本地 agent 的 frontmatter 只保存 `name`、`description`、`model`、`tools`、`user-invocable` 和 `disable-model-invocation`。`name` 精确为 `Ousia Reviewer`；`description` 非空；当前 checkout 的 `model` 精确为 `gpt-5.6-luna::dst (oaicopilot)`；`tools` 为 `[read, search, execute]`；`user-invocable` 为 `false`；`disable-model-invocation` 为 `false`。

`execute` 只用于读取真实 workspace 证据，例如 `git status`、`git diff`、`git log` 和 check-only 查询。Agent body 必须明确禁止修改文件、运行会改变工作区或外部状态的命令，以及调用嵌套 agent。这个约束依赖 agent 指令与 review 过程，不伪装成工具集合提供的机械只读保证；如果以后需要机械隔离，应另行评估宿主是否能提供只读 Git diff 工具，再移除 `execute`。

Agent body 只声明执行载体边界、必须读取的项目 review 入口以及项目补充证据路径，不复制 severity、blocking、输出、复审或 stop condition。`black-team-review` 继续拥有 review 语义和输出合同，项目 facts 仍从 `.ousia/project.json` 与 `.ousia/design/**` owning sources读取。

### Host-owned 生命周期

`.github/agents/ousia-reviewer.agent.md` 是当前项目的 host-owned 个人配置，不是 Ousia asset。首次 setup 由用户或明确的用户请求触发的编辑动作完成，不由 installer、upgrade 或 validation checker 静默创建、覆盖、删除或迁移。

- 文件不存在时可以在明确用户请求下 create-only 创建，并将该路径加入当前 clone 的 `.git/info/exclude`；若 exclude 已有等效规则则保持不变。
- 文件已存在时先验证，不覆盖不同内容。若文件已被 Git track，它是团队共享 surface 而不是个人配置；个人模式停止并要求用户自行移出 tracking 或选择团队模式。
- 文件是 untracked 但内容不同、父路径被普通文件阻塞、或 `.git/info/exclude` 无法安全更新时，报告 `reviewer-host-conflict`，保留现场并要求用户决定；不得隐式替换。
- 迁移前枚举已知 workspace 与 user-level 同名来源。当前未跟踪占位文件 `.github/agents/Ousia Reviewer.agent.md` 由本次明确用户请求删除；随后 create-only 创建 canonical 文件并写入 local exclude；最后按用户明确选择删除 `~/.copilot/agents/ousia-reviewer.agent.md`。任一步失败都报告 `reviewer-host-conflict` 并停止，不启动 review。
- 只有旧 workspace 占位文件与旧 user-level 同名文件均不存在、canonical 文件未被 Git 跟踪且被 local exclude 命中时，迁移才完成。不能把待用户以后清理的同名来源视为可用状态。
- Ousia install、update、retirement 和回滚都 preserve 未列入 manifest 的该文件；回滚只恢复 Ousia-owned instructions/docs，不删除个人 agent。

## 首个可实施纵向切片

用户在当前 Ousia checkout 中获得一个真实可用的本地 reviewer：在单根 workspace 前提下，`.github/agents/ousia-reviewer.agent.md` 是项目 review 执行载体，配置或故障排查时由 VS Code Diagnostics 检查加载来源和模型，README 给出每个项目/用户的设置方式，且 Git 与 installer 都不会接管个人文件。

输入是 workspace root、Git/manifest identity、本地 agent frontmatter 和可用的 customization diagnostics；输出是项目级 review 调用或带有稳定 code 和 remediation 的未启动失败。跨越的边界：custom agent discovery、Ousia baseline call protocol、self-host policy、用户文档和本地 Git ignore。明确排除：manifest schema、installer runtime、review skill 语义、project fact schema、VS Code discovery 实现和模型 API。

完成条件：

- 当前项目的本地 agent 使用精确名称、`gpt-5.6-luna::dst (oaicopilot)` 和受限工具，可配置项目补充证据路径。
- 单根 workspace 的项目文件可被 VS Code 加载；已知 user、parent 或其他 root 同名来源不存在或导致确定性拒绝。
- 全局同名 reviewer 不再成为当前项目的隐式来源；缺失、重复或无效项目 reviewer 的失败行为被文档化并在 review 启动前发生。
- 当前占位 workspace agent 和旧 user-level 同名 agent 已按用户明确决定删除；canonical agent 是已知范围内唯一同名来源。
- 已有 tracked、untracked、父路径冲突和 `.git/info/exclude` 状态均遵循 create-only/preserve/conflict 语义，不发生静默覆盖。
- `framework.json`、`project.json` 和 installer inventory 没有新增 reviewer 字段或 asset。
- 文档 checker 通过，真实 diff 经 focused implementation review 且无 blocking finding。

## 实施步骤

1. 修改 baseline workflow instruction，将 review 载体从“用户级”收窄为“单根当前 workspace 的 `.github/agents/ousia-reviewer.agent.md`”，定义项目 identity、no-fallback、multi-root/nested-root 拒绝和配置诊断边界，并声明不覆盖其 model。
2. 修改 self-host policy，定义项目级个人配置、稳定 failure code、配置验证顺序，以及 installer 不接管未声明 host-owned 文件的规则。
3. 按明确用户决定删除当前未跟踪的 workspace 占位 agent，验证 Git tracking、父路径和 exclude 状态后 create-only 创建 `.github/agents/ousia-reviewer.agent.md`，使用受限取证工具和 `gpt-5.6-luna::dst (oaicopilot)`；写入 local exclude 后删除旧 user-level 同名 agent。任一步失败都停止并保留未完成状态。
4. 更新 README 与 Architecture，说明项目级配置的 owner、创建方式、local ignore、Diagnostics、no-fallback、单根边界和迁移冲突处理。
5. 运行文档协议检查和 `git diff --check`；不修改 manifest，因此不新增 workflow checker 路线。用隔离 fixture 或人工场景证明 installer 对已存在 personal agent 的 preserve 行为。
6. 使用项目级 `Ousia Reviewer` 对真实 implementation diff 做 focused review。只修复 blocking findings，然后对原 finding 和直接回归复审。

## 验证矩阵

| 目标 | Evidence |
| --- | --- |
| 当前 workspace 使用项目级 reviewer | 项目文件的 model 精确为 `gpt-5.6-luna::dst (oaicopilot)`，通过 frontmatter 检查和真实调用；配置或故障排查时由 Diagnostics 确认加载来源和模型，无法检查的宿主来源诚实列为 residual risk |
| 每个用户可独立配置 | 文件未被 Git 跟踪，`.git/info/exclude` 含本地路径；两个 checkout 可拥有不同 frontmatter；tracked 文件会明确拒绝个人模式 |
| review 语义没有复制 | `black-team-review` 仍是唯一 severity、blocking、输出和 stop condition owner；agent 正文只声明执行边界 |
| 不发生跨项目 fallback | 旧 workspace 占位 agent 与旧 user-level 同名 agent 均已删除；instructions 明确缺失、重复、invalid local、multi-root 和 unsupported nested root 即停止；不存在 user-level fallback 规则；invalid-local-plus-valid-global 场景不启动 review |
| 个人文件生命周期不被破坏 | tracked、untracked-different、父路径阻塞、exclude 已有/缺失、upgrade、retirement 和 rollback 场景分别证明 create-only、preserve 或 conflict |
| Ousia 不接管个人文件 | `.ousia/framework.json` 不变；`ousia install --dry-run` 不把 `.github/agents` 列为 asset，未知文件保持不触碰 |
| 配置失败可诊断 | local setup 检查 frontmatter、tools、Git 状态和已知同名来源；VS Code 检查 YAML 与 model；失败输出 `reviewer-project-missing`、`reviewer-source-ambiguous`、`reviewer-config-invalid`、`reviewer-tool-boundary-invalid`、`reviewer-model-unavailable` 或 `reviewer-host-conflict` 及 remediation |
| 文档协议稳定 | `git diff --check -- .ousia` 与 `deno task --cwd .github/skills/doc-validation check:docs` 通过 |
| 实现没有高风险问题 | focused implementation review 输出无 blocking finding |

## 兼容、迁移、回滚与风险

Compatibility 为 `required`：已有 review subject、mode、scope、route、project facts 和 skill 输出保持不变；只替换 review 执行载体的配置位置。旧 user-level agent 的有用执行边界先迁入项目 agent，再按用户本次明确选择删除旧文件，避免宿主发现重复 agent。

迁移入口是用户在当前 checkout 中明确执行的 local setup：先读取既有 user-level agent 的正文作为迁移输入并枚举已知同名来源，检查目标文件、Git tracking、父路径和 local exclude；删除当前未跟踪占位文件，create-only 创建 canonical 项目文件并确认 local exclude 生效，再删除旧 user-level 同名文件。目标已存在且内容不同、已 tracking、父路径被阻塞、exclude 更新失败或任一旧来源无法删除时停止并报告 `reviewer-host-conflict`，不启动 reviewer。回滚只恢复 workflow/self-host instructions 与 README/Architecture 的旧文本，不恢复全局 fallback；不需要数据或 manifest migration。单根 workspace 是当前支持的拓扑；多根、嵌套或 parent discovery 触发确定性 `reviewer-source-ambiguous`，而不是 residual fallback。未来要支持这些拓扑必须另开 proposal。

## Review Focus

- 是否真正把配置作用域收窄到当前项目和当前用户，而不是仅把 user agent 复制一份。
- 是否错误地把 `.github/agents` 个人文件纳入 Framework Manifest、project facts 或 installer lifecycle。
- 是否让 project agent 复制 review skill 的 severity、blocking、输出或 stop condition，形成第二 owner。
- 缺失、名称错误、无效 frontmatter、模型不可用和多根 workspace 是否有明确失败边界。
- 是否把 Diagnostics 的配置与故障排查能力夸大为宿主未提供的调用前 API 或机械唯一性证明。
- `execute` 是否只用于真实 diff 和 check-only 取证，且没有被描述成机械只读边界。
- 是否仍存在隐式 user-level fallback 或 tool-level model 覆盖。
- 当前 checkout 是否精确使用 `gpt-5.6-luna::dst (oaicopilot)`，且两个旧同名来源均在启动 review 前消失。
- README、Architecture 和 instructions 是否描述当前结构而不是迁移流水账。

## Proposal 关闭条件

实施完成、文档验证通过、项目级 reviewer 的真实 implementation review 无 `critical`/`high`，稳定 owner 和 no-fallback 结论写回 Architecture，个人迁移和剩余多根 workspace 风险有明确记录后，关闭本提案并移动到 `.ousia/design/proposal/archive/`，保留编号和关闭证据。
