# Workflow Lessons

## 经验路线

- Runtime 或 editor 专属事实先留在 Experience，直到提升为 Architecture
  或提炼成跨项目 instructions。
- Ousia OS 专属规则不是 Ousia Workflow core；它们应在 Ousia OS 项目安装 workflow
  后保存在该项目内。

## Lessons

- Adapter/profile 拆分不正交。Ousia 控制 `.ousia/**` skeleton；项目只在 Ousia
  定义的 slot 内填充事实。
- Design 只需要 Architecture、Proposal 和 Experience 三个项目原语。Research
  可以在别处发生；有用结论进入 Experience。
- Prompt surface instructions 应作为普通 agent 的读取索引。修改工作流属于作者和
  reviewer 共用的 skills。
- Language、framework、domain 和 testing engineering 应使用 lazy-load
  skills。Base instructions 不应预载当前任务不需要的详细工作流。
- 测试编写细节和反fake-test语义归`test-engineering`按concern加载；workflow
  bootstrap只负责把测试scope路由到该owner。
- 新增 plugin instruction 层会重复 skill discovery，并制造不正交抽象。
- First-party prompt surface 和 design docs 混入英文整句会降低 review
  质量；应保留必要术语和外部标识，但正文规则默认中文。
- 如果 workflow 只说 subagent 可选，subagent review 容易被漏掉。用户明确要求
  subagent review、planning 或 exploration 时，workflow 必须要求尝试启动。
- 用户显式指定 subagent model 时，标识必须来自工具可用模型列表；猜 vendor label
  会导致可避免的首次失败。
- Workflow 执行偏移不应只归因于执行者疏忽。若 agent
  在完成改动后反复写解释、补防御性规则、或把一次用户判断提炼成永久校验，说明
  workflow 没有足够早地要求停下来比较“用户目标、现有协议、最小必要改动和 review
  闭环”。
- Review 闭环如果只写在完成阶段，容易被执行者当成事后可选项。非平凡
  prompt/workflow 改动需要在进入实现前声明 review
  触发条件和启动方式；否则实现者可能用自查、验证命令或总结文字替代真正的
  review。
- Review 闭环也不能把所有启发式 finding 自动升级为返工。模型能力提升后，如果
  `medium`/`low`、替代实现偏好、额外测试组合或文案润色都能持续延长
  review，说明 workflow 缺少 materiality、blocking threshold、用户 opt-in 和复审
  stop condition。后续应只让有证据的阻塞 finding 驱动自动修复；非阻塞观察去重后交给用户决定，复审只验证已接受的阻塞范围及其直接回归。
- 用户纠偏本身是高价值 Experience
  evidence。记录时应保存“未对齐点、错误形态、为什么现有 workflow
  没拦住、后续需要攻击的问题”，不要写成道歉、辩护或即时解决方案。
- 在Agent
  workflow语境中，“真实模型评测”可能指当前Agent或同名subagent读取真实workspace和当前上下文执行planning/review，而不是调用外部模型API。错误形态是未经确认就引入API
  key、HTTP endpoint、provider协议、case
  schema和结果数据库；已有`architecture-planner`、`black-team-review`与subagent闭环已经能承载该目标。后续遇到“模型评测”时，应先确认执行载体和证据边界，并攻击是否用自建harness替代了真实Agent上下文。
- 删除冗余 skeleton
  文件和增加禁止规则不是同一件事。除非存在真实复发路径、外部输入风险或维护者会合理误用的证据，不要把一次结构判断升级成
  doc checker 特化规则。
- Subagent model 踩坑的根因是 prompt
  没把“默认用自身同名模型启动”写成明确执行协议，又把“显式指定模型时必须精确”和“同名模型不可用时停止”混在一起，导致
  agent 传空 `model`
  后把工具失败误归因为额度耗尽；后续修正又把“不要无证据降级重试”误写成“调用形状错误也不重试”。避免复发需要把
  prompt 闭环写清：默认启动 subagent 时传当前主 agent
  的自身同名模型；用户显式指定模型时才改用用户给出的精确标识；启动失败后先确认调用形状是否正确；模型名错误或工具返回可用模型列表时，按证据修正后重试一次；网络、拒绝、额度或其他外部失败按真实失败报告并停止，不降级或循环重试；review
  这类改动时必须攻击“默认模型、显式模型、可修正调用错误和真实外部失败是否被混淆”。
- VS Code 没有任意 subagent 共用的默认模型设置，但 custom agent 可以通过
  `.agent.md` frontmatter 的 `model` 配置自己的模型。调用时显式 model 会覆盖该配置；因此需要持久 reviewer
  偏好时，review 应路由到用户级 custom agent，父 agent 不得继续无条件传同名模型。缺失配置、模型不可用和外部失败必须分开报告，不能静默继承主模型。
- Prompt/workflow 修正不能只局部补一句。连续把“不要空
  model”改成“不要归因外部失败”，再改成“外部失败停止”，再改成“模型名错误可重试”，说明
  workflow 缺少语义冲突和冗余 gate。避免复发需要在新增规则前先查已有 owner，按
  agent 行为判断是否重复或冲突；若只是补例外或拆步骤，应改写原 owner
  的规则，并让 review 攻击“新规则是否覆盖、重复或冲突了已有语义”。
- 引入外部成熟架构思想时，不要为 Ousia
  自造一套新黑话。优先保留经过社区验证、深入人心的术语，例如
  Spring、AOP、IoC、ApplicationContext、Aspect、Pointcut、Advice、Weaving；这些术语能降低人类和
  AI 的理解成本。使用外部术语时必须同时说明它们在 Ousia 中对应的现有
  owner、触发条件和边界，防止语义漂移；只有当现有术语会误导时，才新增 Ousia
  自己的名称。
- Prompt/workflow 改动不能只让 Ousia 自身更整齐。用户目标是让 Ousia Workflow
  指挥 agent 在真实项目中产出有工程感的设计，例如 Rust/Axum 也能形成类似 Spring
  的上下文边界、生命周期、横切 concern、配置落点、诊断和测试支持。后续 review
  应攻击：改动是否说明目标使用场景、真实项目影响和已有 owner 影响；如果只能解释
  prompt surface 更规整，说明仍在学其型而非学其神。
- Baseline skills 不能硬依赖本仓库 `.ousia/design/**` 正文；installer 只分发
  design indexes，host 项目也可能没有本仓库的 proposal body。跨项目必须生效的
  evidence 字段和 review attack 应由 owning skill 自身承载，installed
  `.ousia/**` 只能作为当前项目的补充事实、约束、reference 或 Experience
  evidence。后续 review 应攻击 prompt surface diff 是否把 self-hosting proposal
  当成 baseline 依赖。
- Prompt
  surface精简不能用文件数替代语义验收。把任务流程迁入skills是正确的，但调用边界、唯一owner、失败前置检查和行为测试evidence等跨任务硬规范若只存在于lazy-load
  skill，分类或route漏读时就会失效。后续收敛instructions时应逐条证明有效语义有唯一owner、真实route会加载该owner、安装目标能获得对应asset；不要以“baseline只剩几个文件”作为成功标准。
- 本次纠偏暴露了一个归类错误：`module::function` 类调用形状和固定 `TODO(scope)`
  曾被当成语言或风格偏好而删除。前者实际保护调用点可见的语义 owner 和成熟库式
  API，后者保护跨 Agent 可检索债务；只剩抽象的“唯一 owner”时，裸函数、通用
  helper 容器、静默 placeholder 和接手遗漏不再有直接攻击面。复发信号是 review
  只评价固定标点或格式，却没有检查非局部行为归属、调用来源和临时实现的原因与退出条件。
- Engineering quality 接入 planner/reviewer 后必须用场景验证 evidence gate
  是否真实工作。Rust/Axum dry-run 已记录在
  [engineering-quality-dry-run.md](./engineering-quality-dry-run.md)：样本显示
  planner/reviewer 能检查 entry boundary、orchestration owner、state
  owner、validation authority、side-effect boundary、configuration
  owner、diagnostics contract、test contract 和 handoff
  docs，而不是只接受目录模板、service 命名或抽象口号。
- 测试规范存在不等于 review 会执行。一次 installer
  成熟化实现中，`test-engineering` 已要求非平凡测试暴露
  Goal、Scope、Semantics，失败路径证明状态不变，fixture 不隐藏 owner；但
  implementation review 长期只确认测试存在、通过和覆盖 rollback/JSON
  等行为，没有逐项审查测试契约。根因是领域 skill
  仍被当成“显式测试任务才读取”的可选能力，而不是 review scope
  命中测试文件或测试证据时的 mandatory
  evidence。避免复发需要：`black-team-review` 根据 scope 强制读取相关领域
  skill；实现 review 输出 Test contract evidence；测试文件用短注释或 case label
  暴露 Goal/Scope/Semantics；fixture 名称说明它是 minimal policy/source fixture
  还是真实 workflow 入口。后续 review 应攻击“测试是否只是存在并通过，还是按
  test-engineering 证明了用户语义、调用边界和失败后状态不变”。
- AI测试治理不能靠提高测试数量、rstest占比或checker通过率替代语义审查。一次Rust
  checker迁移中，机械补齐GSS后 inventory显示全部contract complete，但专项review仍发现
  `Scope.boundary`被句号污染、一个测试混合两条无关规则、重复trait fixture和历史placeholder
  断言。复发信号是GSS只能复述函数名、同一测试必须描述两个不同失败条件，或fixture增加内容却不增加
  可观察证据；这些测试应删除、拆分或重写，而不是继续增加注释。
- `rstest`应积极用于同一owner、边界和不变量下的真实输入矩阵，但不能成为所有测试的统一外形。
  Named cases改善失败定位并约束AI复制；单场景无能力`rstest`、笛卡尔积`values/files`和无语义
  case label只会增加宏展开与管理噪音。Review必须比较inventory中的matrix candidates与真实契约，
  不能把fingerprint相似直接当作合并结论。
- 静态test inventory的候选算法只能提供人工review入口。真实样本中，literal-normalized
  fingerprint会把不同owner的相似assert形状误报为parameter matrix，direct-call owner family
  会把正常`SourceSet -> ParsedCrateSet -> Report` integration pipeline误报为multi-contract，
  同时漏掉被局部helper隐藏的真实multi-contract。后续review应先看GSS boundary、direct calls、
  oracle和fixture，再决定删除、拆分、矩阵化或architecture handoff；candidate不能升级为hard gate。
- Source-level Rust测试治理不能把physical file、logical module occurrence和production/test
  universe压进同一个parsed module。真实反例包括同一physical source被两个`#[path]`引用、
  `cfg_attr(path = ...)`的互斥alternatives、conditional test carrier和parse fatal；继续加
  `test_context`或consumer skip只会产生第二份语义owner。后续review应攻击consumer是否重新递归
  module、重新解析`cfg_attr`或静默跳过parse/model失败，并要求所有evaluator消费同一total session。
- Rust attribute治理不能用token/string substring恢复语义。`case`或`ignore`可能出现在无关literal、
  path或nested meta中；substring判断会把边界条件堆成伪parser。后续实现应让grammar owner一次产生
  typed carrier、conditional meta、guard和location facts，再由test domain只判断placement与规则；
  malformed grammar必须typed fatal或typed issue，不能降级为`false`分支。
- Guarded module graph不能用“至少一个candidate存在”代替branch coverage。Conditional path和
  default path即使互斥，每个可达guard区域仍必须被实际source覆盖；后续review应攻击
  $SAT(declaration\_guard \land \neg existing\_candidate\_guards)$，并把missing与ambiguity分开。
- Wire identity不能来自DFS/vector insertion ordinal。无关sibling插入或重复CLI input若改变
  test IDs，inventory就无法稳定比较；后续review应要求subject semantic dedup先于wire identity，
  occurrence identity来自declaration lineage，同时保留同一physical source的多个logical occurrences。
- Function-only projection不足以证明production语义。Impl、trait、foreign、use、import、callsite和
  callee若仍由consumer读取裸AST，`cfg(test)`误报和互斥guard假usage会回归；后续review应要求
  analysis提供组合式item/callable indexes，而不是在每个consumer补skip或建立巨型optional model。
- Rust owner checker若严格限制module owner与type共存，同时允许不携带self type的associated
  function用reason豁免，会激励agent创建unit struct函数口袋来绕过module-function约束。新增
  `namespace-type`或`capability-type`允许marker不能证明真实owner，只会把逃逸变成带说明的逃逸；
  假receiver、无意义`Self`返回、`PhantomData`字段和dummy trait仍可规避语法规则。后续review应先问
  类型是否作为值被构造、传递、存储，或承载trait、typestate、capability和不变量；没有值语义时让
  行为回到精确owning module。适合hard gate的是marker的placement、reason、冲突与冗余等AST事实；
  空类型是否只是namespace应先作为带macro/cross-crate能力声明的report candidate积累precision
  evidence，不能直接hard fail或新增允许marker。
- 共享analysis fact只有在所有consumer删除自有resolver后才是真正的唯一owner。一次checker复审发现
  function usage与zero-field type各自维护use-tree展开和lexical path解析；即使条件测试都通过，alias、
  `self`/`super`和guard组合仍可能漂移。后续review应搜索同类AST grammar和path resolution副本，要求
  `GuardedUseIndex`一类中性projection同时服务call/type consumer，并让consumer只拥有领域关联。
- Installed smoke必须断言真实输出通道，不只搜索合并后的进程文本。Strict hard diagnostic属于stderr，fatal
  还必须证明stdout为空；把diagnostic误查stdout会让测试自身成为错误契约，即使本地实现碰巧输出可见。
  后续review应对exit code、stdout、stderr和partial payload分别断言，并让installed source清单覆盖新增目录文件。
