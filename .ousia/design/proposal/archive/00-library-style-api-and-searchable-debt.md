# 00 库式调用面与可检索债务

## 关闭结局

提案已实施并通过 implementation review。稳定的工程
owner、调用面和临时债务规则已进入 owning instruction、skills 与
Architecture；归档后不再作为当前方案读取。

## 用户目标

内部代码应按成熟第三方库的标准组织和调用：每个可调用行为有明确归属，跨模块调用点能直接看出语义
owner。Agent
有意留下的不完整实现还必须形成可全局检索的债务，避免后续接手者遗漏。

Mode 为 `重构`，target 为
`代码`，`compatibility: forbidden`。本次不保留裸调用兼容层、聚合 re-export、旧
API facade 或双调用路径。

## 当前问题

现有工程 instruction 已要求编排、状态、校验、错误映射和副作用有唯一
owner，但没有把这一不变量投影到每个非局部函数和调用点。当前 TypeScript
一方模块使用 named import 后裸调用，例如 `planInstall(...)`；owner
只在文件顶部可见，阅读主流程时需要回查 import。

`engineering-quality` 已要求临时实现说明最终 owner
和退出条件，但没有稳定文本协议。普通注释、静默 fallback 或抽象命名仍可能让后续
Agent 无法通过全局检索发现债务。

## 候选方案

### 方案 A：只补 Prompt 规范

只修改 instruction 和
skills，不调整当前源码。改动最小，但仓库自身继续保留与新规范相反的调用样本，会削弱
few-shot evidence，也无法证明规范能映射到真实代码。

### 方案 B：补规范并迁移当前一方调用面

由工程 instruction 拥有硬规则，`engineering-quality` 拥有 evidence、例外和
smell。先审计导出行为是否属于当前模块，再让真实 owner 的 TypeScript API 使用
namespace import，使调用点表现为
`planner.planInstall(...)`、`source.readSourceSnapshot(...)` 等库式
API。采用该方案。

### 方案 C：同时加入 TODO Checker

Checker 可以验证已存在标记的格式，却无法可靠识别所有未标记
placeholder、降级分支或临时实现，容易把文本检查伪装成语义闭环。本次不采用；先积累真实违规和误报
evidence。

## 推荐方案

### 规范 Owner

- `ousia-engineering-standards.instructions.md`：非局部行为归属、调用点 owner
  可见性和 `TODO(scope)` 格式的唯一硬规则 owner。
- `engineering-quality`：调用面、合法例外、临时债务 evidence 与 smell。
- `black-team-review`：沿用现有领域 skill
  组合与实现审查义务，不增加专用规则正文。
- `.ousia/framework.json`：保持现有 route 和 asset
  identity，不保存工程规则正文。

`ousia-prompt-architecture.instructions.md` 已把调用边界和唯一 owner 路由到工程
instruction，`black-team-review` 也已要求实现审查读取
`engineering-quality`。本次不为“相关”而重复修改它们；新行为分别在工程
instruction 和 `engineering-quality` 原 owner 内闭合。

### 行为 Owner 审计

Namespace 只投影已经成立的
owner，不能把文件来源伪装成语义归属。迁移每个调用前按以下三类处理：

1. 模块确实拥有该行为，例如 planner 拥有安装计划、source 拥有 source
   snapshot、applier 拥有文件事务；调用点使用 namespace 显露 owner。
2. 通用容器或错误转发不拥有行为；调用方改为直接依赖真实
   owner，或将行为移到能说明职责的模块。
3. 只服务单一相邻 owner 的局部实现细节保持私有，不为调用形状创建公共 API。

`test/helpers.ts` 当前混合测试项目构造和文件探针，不能通过 `helpers.*`
前缀自动获得语义 owner。本次将其收敛为测试项目 fixture
owner，并使用能说明职责的模块名。文档 checker 的 `document-tree.ts` 当前
re-export `@std/path` 能力；调用方改为直接依赖
`@std/path`，不把外部路径语义错误归给 document tree。

现存相对 value import 和转发 export 的审计结论如下；未列出的 type-only import
不改变运行时调用面：

| 当前能力                                    | 真实 Owner                    | 动作与理由                                                                                                        |
| ------------------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `readSourceSnapshot`                        | `source`                      | 保留并改为 `source.readSourceSnapshot`；source 拥有 inventory snapshot 构建                                       |
| `planInstall`、`summarizePlan`              | `planner`                     | 保留并改为 `planner.*`；planner 拥有计划决策和摘要                                                                |
| `applyInstallPlan`、`ApplyError`            | `applier`                     | 保留；函数改为 `applier.applyInstallPlan`，错误 class 以 `applier.ApplyError` 显露事务 owner                      |
| `installOusia`                              | `installer`                   | 保留并改为 `installer.installOusia`；installer 拥有 source → plan → apply 编排                                    |
| `runCli`                                    | `cli`                         | 保留并改为 `cli.runCli`；CLI tests 通过真实命令入口验证用户可观察行为                                             |
| Manifest load/route/glob API                | `manifest`                    | 保留并改为 `manifest.*`；Manifest 模块拥有 schema 和 route 语义                                                   |
| `sha256`                                    | 新 `digest` 基础设施模块      | 从 `source` 移出；source、planner、applier 和 tests 直接依赖 `digest.sha256`，不把通用摘要语义伪装为 source owner |
| `parentDir`                                 | 无                            | 删除未使用的 `dirname` 薄包装，不创建 owner                                                                       |
| Frontmatter parser                          | `frontmatter`                 | source 和 checker tests 使用 `frontmatter.parseFrontmatter`；解析协议由该模块拥有                                 |
| Test project construction、`repoRoot`       | 新 `project-fixture` 测试模块 | 从 `helpers.ts` 移入并使用 `projectFixture.*`；它拥有测试项目准备                                                 |
| Test `exists`、`readText` probes            | 新 `file-probe` 测试模块      | 从 `helpers.ts` 移入并使用 `fileProbe.*`；它拥有测试文件观察，不与 fixture 构造混合                               |
| `checkDocs`                                 | `check-docs-lib`              | 保留并以 `checkDocs.checkDocs` 调用；该模块拥有 checker 编排                                                      |
| `formatDiagnostics` 和 diagnostic types     | `diagnostics`                 | 删除 `check-docs-lib` 转发 export；CLI 直接使用 `diagnostics.formatDiagnostics`，消费者直接引用真实 owner         |
| `basename`、`dirname`、`extname`、`resolve` | `@std/path`                   | 删除 `document-tree` 转发 export；checker 调用方直接依赖外部 owner                                                |
| `readDocumentTree`、`resolveAgainst`        | `document-tree`               | 保留并使用 `documentTree.*`；前者拥有文档树读取，后者拥有 checker 的规范化文档路径解析                            |
| `runProtocolRules`                          | `rules`                       | 保留并改为 `rules.runProtocolRules`；rules 拥有协议规则执行                                                       |
| `DiagnosticBag`                             | `diagnostics` 类型 owner      | 使用 `diagnostics.DiagnosticBag`；class 名和 namespace 同时显露诊断归属                                           |
| `deno` runtime object                       | `deno-runtime`                | 保留现有 `deno.*` 调用；导出对象本身已是 owner-visible API，不再套第二层 namespace                                |

该审计覆盖相对可调用 value import 和转发 export；protocol constants
等非调用值继续由其声明模块拥有，不要求为常量访问机械增加
namespace。审计允许删除内部误归属 export 和测试 support 文件重组；它们不是兼容
surface。生产 CLI 行为、installer transaction 和 Manifest
语义仍必须保持不变，不建立旧 export facade。

### 跨语言投影

规则约束语义 owner，不固定标点：Rust 可表现为
`module::function`，TypeScript、Python 和 Go 可表现为 `module.function` 或
`package.Function`，Java/C# 可表现为 `Type.method`。实例方法、trait/interface
方法和只服务相邻 owner 的局部私有 helper 可遵循语言惯例。

本次强制约束一方模块调用。外部依赖继续遵循其成熟公开 API；不为形式统一把
`@std/path` 或断言库机械改为 namespace 调用。

### 临时债务协议

有意保留的临时实现、stub、placeholder、降级路径或跳过分支必须在最近位置写：`TODO(scope): reason; exit condition`。

- `scope` 必须非空并能归类能力或边界。
- `reason` 说明为什么当前仍需保留。
- `reason` 同时说明当前不可依赖的语义或验证缺口。
- `exit condition` 指出最终 owner 和完成或删除所需的验证 evidence。
- 完成实现时同步删除标记。

固定 `TODO(` 前缀提供稳定全局检索入口；普通注释、空实现、静默 fallback
或更抽象的命名不能替代该协议。

## 最终目标状态

1. 每个非局部可调用行为都能说明领域、编排、模型、校验、配置、诊断、adapter
   或副作用 owner。
2. Owning source inventory 中的一方跨模块调用在调用点显露真实 owner；type-only
   import、同文件调用和外部依赖 named import 保持语言惯例。
3. CLI 输出、installer transaction、Manifest
   语义和测试保护的用户可观察行为不变；owner 审计表标记为误归属的内部 export
   可以移动或删除，不保留旧 facade。
4. 当前 source-owned 文件不存在未按协议声明的真实 TODO、FIXME、stub 或
   placeholder。
5. Prompt 规则只有一个权威 owner；skills 只保存 evidence 和审查义务。

## 第一个纵向切片

先修改工程 instruction 和 `engineering-quality`，再审计并迁移 `src/installer.ts`
的 source → planner → applier 调用链。该切片必须先证明三个模块分别拥有
snapshot、plan 和 transaction 行为，再以类型检查和 installer tests
证明调用形状变化未改变行为。

第二个切片迁移其余 owning source，并修正发现的错误 owner：测试 fixture support
使用明确模块 owner；文档 checker 不再从 document-tree 转发外部 path API。

### Owning Source Inventory

| 分类                      | 路径                                                  | 处理                                                        |
| ------------------------- | ----------------------------------------------------- | ----------------------------------------------------------- |
| Runtime source            | `src/*.ts`                                            | 审计 owner 并迁移内部调用                                   |
| Runtime tests             | `test/*.ts`                                           | 审计测试 fixture owner 并迁移内部调用                       |
| Release/install source    | `scripts/*.ts`                                        | 只迁移真实内部调用                                          |
| Smoke source              | `smoke/*.ts`                                          | 只迁移真实内部调用                                          |
| Docs checker source/tests | `.github/skills/doc-validation/scripts/*.ts`、`.d.ts` | 审计内部调用；直接依赖外部 path owner，类型声明只检查不改写 |
| Empty package slots       | `packages/ousia/**`                                   | 无 owning source，不创建 placeholder                        |
| Generated/runtime workdir | `smoke/workdir/**`                                    | 排除；由 smoke/release 重建或验证                           |
| Build/unpack snapshots    | workdir 内 release、updated-source、unpack            | 排除；不手工同步                                            |

Inventory 只包含仓库实际维护的一方 source，不把安装结果、解包副本、fixture
内容或生成快照当成第二 owner。

### 债务扫描协议

从仓库根运行扫描。Owning source 文件列表由以下固定 pathspec
展开：`src/*.ts`、`test/*.ts`、`scripts/*.ts`、`smoke/*.ts`、`.github/skills/doc-validation/scripts/*.ts`
和 `.github/skills/doc-validation/scripts/*.d.ts`。不使用递归
`smoke/**`，因此不会进入 `smoke/workdir/**`。

实施 review 保存以下两类扫描的完整输出：

1. 债务标记：对 owning source 文件匹配所有 `TODO` 和
   `FIXME`。每个匹配必须分类为合法债务标记、专门验证协议的测试输入或违规；违规和未分类匹配必须为零。
2. 语义线索：大小写不敏感匹配
   `stub|placeholder`。每个匹配必须记录为协议/测试字符串、稳定领域术语或真实临时实现；未分类匹配视为验收失败，真实临时实现必须改为合法
   TODO 或完成实现。

合法 TODO 的机械格式为单行 `TODO(scope): reason; exit condition`：scope、reason
和 exit condition 去除空白后都非空，reason 与 exit condition
以第一个分号分隔。`reason` 描述当前不可依赖语义或验证缺口；`exit condition`
命名最终 owner 以及完成或删除所需
evidence。测试字符串若专门验证该协议，可以保留，但必须在同一分类结果中标记为测试输入，不能被误计为真实债务。

## 验收矩阵

| 目标                 | Evidence                                                                                               |
| -------------------- | ------------------------------------------------------------------------------------------------------ |
| 硬规则只有一个 owner | Prompt diff review 检查 instruction、skills 和 Manifest 没有重复正文                                   |
| 调用点显露真实 owner | 按 owning source inventory 扫描相对 named value imports，并逐项审查导出行为与 namespace 是否同一 owner |
| 行为保持不变         | `deno task check`、`deno task test`、`deno task smoke:install`                                         |
| Prompt surface 有效  | `deno task check:workflow` 和文档协议检查                                                              |
| 发布路径无回归       | `deno task release`                                                                                    |
| 债务协议可检索       | 按债务扫描协议保存完整结果；违规和未分类 TODO/FIXME 为零，`stub`/`placeholder` 线索全部完成分类        |

## 回滚与风险

调用面迁移只改变 import 和调用表达式，可按文件回退，不需要状态迁移。主要风险是
namespace 名与局部变量冲突、错误地改写外部依赖或把 namespace
形式本身当成架构质量。Review 必须确认每个限定名对应真实语义
owner，而不是形式噪音。

TODO checker 延后并不意味着协议可选；本次扫描只覆盖 owning source
inventory，并排除 Proposal/Experience 正文、测试字符串、fixture
内容、外部声明和生成目录。`TODO(`/`TODO:`/`FIXME`
是确定文本入口，`stub`/`placeholder` 仅触发人工判断，不自动认定违规。本次通过
always-on instruction、engineering evidence、精确检索和真实 diff review
执行；只有积累足够低误报样本后，才为 checker 单独建立 Proposal。

## Review Focus

- 三条规则是否来自同一 owner 模型且没有互相重复。
- “调用点显露 owner”是否保留语言惯例和外部库例外。
- namespace import 是否对应真实行为
  owner，而不是为通用容器或转发导出增加无意义前缀。
- `TODO(scope)` 是否同时要求原因和退出条件。
- owning source inventory 是否完整区分文档 checker、fixture support 和生成副本。
- 是否夹带 public API 兼容 facade、生成文件修改或外部依赖风格统一。
