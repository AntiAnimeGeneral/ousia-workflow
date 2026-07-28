---
name: rust-engineering
description: "用于设计、实现、专项审查或全局启发扫描 Rust source、Cargo workspace、crate、module、Rust API、ownership/error boundary、unsafe、panic/unwrap、测试或 Rust 验证；review Rust diff 时必须参考。"
argument-hint: "Rust 文件或扫描范围、Cargo metadata、API 设计目标、审查/扫描重点和验证期待"
---

# Rust 工程

Rust/Cargo 投影。通用硬边界由 `ousia-engineering-standards.instructions.md`
提供；详细工程和测试 evidence 分别归 `engineering-quality` 与
`test-engineering`。

## 范围

- Rust source、module、crate、workspace 和 Cargo metadata
- Rust API、trait、enum/newtype、Result/error boundary 和 ownership design
- panic、unwrap、expect、unsafe、状态机和 match 完整性
- Rust tests、benches、fuzz、fixtures 和 validation commands

## 设计

- Rust API 应以调用者不易误用为目标。
- 用类型系统承载边界和不变量。
- 用清晰的 enum、newtype 和 `Result` 表达状态与失败。
- 用所有权和借用关系表达可变状态归属。
- 不要为了贴近 C API
  外形而保留参数堆叠、裸整数语义、隐式输入顺序或容易混淆的调用面。

## 实现

- Rust 状态机、权限判断、能力类型、对象类型和架构分支优先使用显式 enum match。
- 不要用 `_` 或 wildcard fallback 吞掉未来新增状态，除非该 fallback
  是经过设计的兼容语义，并且有测试覆盖。
- Rust 中有语义的 magic number 使用常量。
- 同一模块内可以通过 `use` 引入频繁使用的类型、trait、常量和构造器。
- 禁止 `use ... as ...`
  alias；遇到同名末级对象时，在调用点保留模块前缀或更完整路径区分， 不通过
  import 改名隐藏 owner 语义。
- 承载独立领域动作的模块级函数调用优先保留 `module::function` 形式，让模块 owner
  和函数动作一起表达完整语义。
- 只有当模块名不承载领域语义、路径只是机械命名空间，或局部辅助逻辑已处在明确
  owner 内时，才把函数导入后用短名调用。

## 裸函数定义验证

Rust 模块级 `fn` 定义必须能被程序化检查证明 owner，不允许无归属裸函数静默进入
baseline。第一版验证使用 `.github/skills/rust-engineering/checker` 中的 Rust
checker crate，由本 skill 拥有规则语义和 reviewer obligation。

允许形态：

- 模块声明 `#![doc = "ousia: module-owner owner-name"]`，或 inline module 声明
  `#[doc = "ousia: module-owner owner-name"]`。模块 owner
  证明其中模块级函数属于该 owner，并保留 `module::function` 调用形态；该 marker
  必须实际覆盖至少一个模块级 function，不能用于只包含类型、impl、trait
  或测试脚手架的模块。普通 `use`、 `const`、`static`、macro 和 extern block
  可以作为函数 owner 的支撑项留在同一 scope；类型定义、trait 定义、impl block 和
  re-export 不能被 module owner 顺手覆盖。
- 单个模块级函数声明 `#[doc = "ousia: ownerless-fn reason"]`。该 marker 只豁免
  当前函数，`reason` 必填；如果它表达临时债务，还必须同时遵守工程 TODO 协议。 该
  marker 不适用于无校验、无状态提交、无错误映射的纯转发薄包装。
- `impl` 方法若签名中不包含本类型参与，则必须用
  `#[doc = "ousia: ownerless-method reason"]` 标注；这里的本类型参与包括 `self`
  / `&self` / `&mut self`、`Self` 返回值，以及被
  `Result`、`Option`、引用、切片、数组、元组或泛型包装后仍显式携带本类型的签名。`reason`
  必填；该 marker 只适用于inherent impl中签名不包含本类型的静态helper，不适用于模块函数、
  trait impl method、trait item或外部块项。Trait impl method由trait与实现类型共同拥有，不需要
  ownerless marker。
- Trait item、trait default method、extern block item和宏展开产物不属于第一版检查范围。

禁止形态：

- 模块级函数既没有模块 owner，也没有带 reason 的 ownerless function marker。
- 模块 owner marker 没有覆盖任何模块级 function。
- 模块 owner marker 所在 scope 混入类型定义、trait 定义、impl block 或
  re-export；checker 报 `rust-module-owner-mixed-items`。
- 使用 `use ... as ...` alias；checker 报 `rust-use-alias-forbidden`。这包括普通
  rename、 grouped `self as alias` 和匿名 `_` alias。
- `impl` 方法的 ownerless 标注是否只落在签名里不含本类型参与的静态 helper；
  `self`、`Self`、`Result<Self>`、`Option<T>`、引用、切片、数组、元组、泛型包裹等仍承载本
  类型语义的方法不应被误判。
- 有module owner的函数不得再声明ownerless function marker；Self-bearing inherent method和trait
  impl method不得声明ownerless method marker。同一item不得重复声明同类ownerless marker。
- 使用普通注释作为 owner marker；checker 只接受可编译的 Rust `doc` attribute。
- 使用未知 `ousia:` marker，或把 ownerless function marker 放到非函数项上。

Review Rust diff 时必须检查：新增模块级函数是否有模块 owner；ownerless marker
是否真的必要且有 reason；inline module 是否继承或声明正确 owner；checker
是否纳入 validation route 和 release gate。

Checker 分两类入口：`check` 输出 diagnostic 并用非零退出码阻断；`report` 输出
review 发现但不拥有硬失败语义。两者共享完整 `AnalysisSession`：physical source只读取和
parse一次，logical module occurrence与physical identity分离，production/test reachability由
同一cfg projection计算。Subject、read、parse、cfg、graph、model或render失败为exit 2且不输出
partial payload；hard diagnostic为exit 1，report成功和not-applicable为exit 0。

## Rust 测试契约与 inventory

Rust测试语义归 `test-engineering`；本节拥有 Rust carrier、source test universe、rstest
shape、diagnostics、inventory schema/CLI和领域 review evidence。

- 每个受支持 source-declared test function恰好使用三个直接 literal doc attributes：
  `Goal: ...`、`Scope: level=<unit|module|integration|contract|smoke>;
boundary=<owner-visible path>`、`Semantics: ...`。不接受 continuation、额外 rustdoc、
  non-literal/conditional doc或第二种 carrier。
- Checker覆盖 Cargo metadata中 `Target.test == true` 的 known targets里的
  `#[test]`、`#[rstest]`、path末段为 `test` 的 attributes及
  source-declared `cfg_attr(..., test)`。不展开 macros、doctests或 runtime inventory；
  production function-owner rules继续排除 Cargo test targets、test functions和
  `cfg(test)` modules。
- 两个或更多同契约输入使用独立 `#[case::semantic_label(...)]` 的 `rstest` matrix。
  V1禁止 `values`、`files`、compact cases和conditional cases。单场景仅在真实使用
  fixture/context/trace/timeout/test-attr能力时可以使用 rstest，否则用原生 `#[test]`。
- Test-level ignore只接受 `#[ignore = "non-empty reason"]`；parameter-level rstest ignore
  不属于该规则。

Hard diagnostic family：

- Owner marker：`rust-ownerless-fn-reason`、`rust-ownerless-method-reason`、
  `rust-ownerless-fn-conflict`、`rust-ownerless-method-unnecessary`、
  `rust-owner-marker-duplicate`。正确placement后先校验每个marker的reason；某marker的reason非法时，
  该marker不再报告conflict/unnecessary。Duplicate独立结算并定位第二个同类marker。

- GSS：`rust-test-contract-missing`、`rust-test-contract-field-order`、
  `rust-test-contract-duplicate-field`、`rust-test-contract-empty-field`、
  `rust-test-contract-placeholder`、`rust-test-contract-scope-invalid`、
  `rust-test-contract-carrier-invalid`、`rust-test-attribute-invalid`。
- Shape：`rust-rstest-no-capability`、`rust-rstest-case-label-missing`、
  `rust-rstest-case-label-duplicate`、`rust-rstest-values-forbidden`、
  `rust-rstest-files-forbidden`、`rust-rstest-compact-case-unsupported`、
  `rust-rstest-conditional-case-unsupported`、`rust-test-ignore-reason`。

`report test-inventory --format json|markdown [CARGO_INPUT...]`输出同一
`ousia.rust-test-inventory.v1` model。JSON是机器权威，分开保存GSS contract status、shape
status和统一issues；issues携带`contract|shape` category，shape保存test carriers、canonical
guard/effective activation、rstest named cases及source-visible case attributes。Inventory同时记录
occurrence identity、rustc cfg digest与固定SAT预算；Markdown只渲染测试名、GSS、
named cases、direct function calls/receiver methods、oracle facts、summary和保守
candidate evidence，并按Cargo package、target、module和完整Scope稳定分组；invalid contract保留
package/target/module层级并统一进入invalid Scope bucket。Report保留缺失或非法 contract并正常退出，parse/IO/configuration、
重复 identity或model invariant失败时不输出部分报告。

Rust test diff必须提供并消费 inventory：reviewer逐项检查新增/删除测试、GSS真实性、
真实调用边界、oracle evidence、matrix shape和 candidate groups。Candidate永不承担 hard
failure或自动删除；exact clone、parameter matrix、multi-contract和weak-oracle只触发人工
判断或 architecture handoff。最终治理必须对每个`candidate code + sorted test IDs`记录
`保留|删除|拆分|矩阵化|architecture handoff`及理由；任何影响test source、分析模型、fingerprint、
candidate或renderer的改动都会使artifact和disposition失效，必须重新生成并复审。

Rust checker hard rules 作为可管理规则族维护：共享 AST 遍历与module dispatch归 checker
`engine`，diagnostic sink归`rules/context.rs`；module owner lineage与settlement归
`rules/module_owner.rs`，impl self-type signature语义归`rules/impl_method_owner/signature.rs`，其他单条规则
语义归`rules/*`中的唯一rule owner。Test inventory aggregate归`test_analysis.rs`，wire model、GSS、rstest
shape、facts、fingerprint与candidate分别归相邻模块。新增或修改 hard rule 必须同时具备 stable diagnostic code、触发输入、
允许/禁止语义、正例测试、必须报告的反例测试、skill
文档和验证路线。不要为了规则增长 引入动态 plugin registry、空 hook 或薄
wrapper；只有规则需要 type information、macro expansion 或 rustc HIR
时，才重新评估 Dylint / rustc lint 级工具链。

## Checker 使用

- CLI
  形状：`check [CARGO_INPUT...]`、`check-project <project-root>`、
  `report function-usage [CARGO_INPUT...]`、`report module-layout [CARGO_INPUT...]`、
  `report test-inventory --format json|markdown [CARGO_INPUT...]`。省略子命令等价于 `check .`。
  `report zero-field-types [CARGO_INPUT...]`输出空字段类型候选JSON。
- `[CARGO_INPUT...]` 只接受一个或多个 `Cargo.toml`，或当前层直接包含
  `Cargo.toml` 的目录；checker按 Cargo metadata读取targets并沿out-of-line module
  tree展开。`.rs`、普通文件和不含manifest的目录是
  `subject-cargo-manifest-required` fatal input。
- `check` 退出码非零表示 hard rule 失败；按 diagnostic code 修复 owner
  marker、scope 或 placement 后重新运行同一输入。
- `check-project`是 installed host gate。Root `Cargo.toml`优先；否则唯一 resolver读取
  `.ousia/project.json` 的可选 `project.rust.sourcePaths`。该数组只接受project-root
  relative `Cargo.toml`或当前层直接包含manifest的目录；absent/empty为not-applicable，
  旧 `.rs`、manifestless directory和其他非法配置为exit 2。普通 `check`/`report`
  不读取Ousia project facts。
- `report` 必须带具体 report 子命令。`report function-usage [paths...]`
  输出 TSV：`used_by_functions`
  是唯一调用方函数数量，`target` 是唯一 Cargo target
  标识，`function` 是被调用函数，`callers` 是逗号分隔的调用方函数，`location`
  是函数定义位置；输出按 `used_by_functions` 全局降序排列。
- `report function-usage` 的被调用方只统计同一解析 crate/module tree
  内的模块级函数； 调用方统计模块级函数、`impl` 方法和 trait default method
  中的直接调用。支持 `crate`、 `self`、`super`、`Self` 路径和显式 `use`
  导入；为分析历史或外部代码，report 可以解析 rename import，但 `check` hard
  rule 不允许新增 alias。不分析接收者方法调用、trait dispatch、宏展开产物 或跨
  crate usage。它只用于 review 分析，不作为 release gate 或 hard-rule evidence。
- `report module-layout [CARGO_INPUT...]` 输出 TSV：`target`、`module`、
  `current_path`、`recommended_path`、`kind` 和 `reason`。该入口只报告实际解析到的
  `mod.rs` 模块作为 Rust 2018 layout 自省候选；`#[path]` 指向的 `mod.rs` 必须人工
  review。`mod.rs` 不是 hard rule，checker discovery 必须继续支持合法的
  `mod.rs` 布局。Cargo metadata是crate root和target universe的唯一输入权威。
- `report` 输出的 marker / usage
  候选应进入复审闭环：先判断标记本身是否仍合理，再判断
  标记是否代表可收敛的职责簇或更合适的 owner；如果结论是不合理或 owner
  失配，先进入 `black-team-review` 的 `scan` 或 `diff` review，再按需交给
  `architecture-planner` 产出 重构 proposal，最后重跑 `check` 和相关 `report`
  验证闭环。

## Panic 和不变量

- 只有失败完全不可能发生，且该假设未来可以自然替换为 unchecked assumption
  时，才使用 `unwrap`；必要时用短注释说明不可失败原因。
- 只有错误的内部调用、错误的 API 使用或内部 invariant
  破坏才会触发，而正确调用不会触发时，才使用带语义说明的 `expect` 或 invariant
  assertion。
- 如果校验函数已经建立 invariant
  并返回后续需要的数据、引用、索引、句柄或提交计划，应直接消费该返回值；不要再次查找后用
  `expect` 取同一个事实。
- 可能由外部输入触发的失败不能靠 `expect` 处理。

## 审查

- API 是否用 Rust 类型系统防误用，而不是暴露 C-style 参数组合。
- 状态机 match 是否显式覆盖当前语义，未来变体是否会被 wildcard 静默吞掉。
- `unwrap`、`expect`、panic 和 assertion 是否只表达内部 invariant。
- 校验后是否直接消费已验证返回值，避免重复查找同一事实。
- 模块路径和 `use` 是否保留 owner 语义。
- 测试是否通过真实 Rust API 触发语义，而不是复述内部 match 表。
- checker / report / review
  闭环是否真的把标记当成待复审对象，而不是把发现直接当成结论； 对不合理标记或
  owner 失配，是否已经经过 `black-team-review` 到 `architecture-planner`
  的重构路径，并在重构后重新验证。

## 验证

按项目 workflow route 或 installed adapter facts 选择命令。常见 Rust checks
包括：

- `cargo fmt --check`
- `cargo check`
- `cargo test`
- `cargo clippy`

Ousia Rust function owner checker：

- `cargo run --quiet --locked --manifest-path .github/skills/rust-engineering/checker/Cargo.toml -- check .github/skills/rust-engineering/checker/Cargo.toml`
- `check` 输入只接受`Cargo.toml`或当前层直接包含manifest的目录，并沿Cargo metadata
  targets及out-of-line `mod`展开crate tree。
- `report function-usage` 是模块级函数被所有可命名 callable
  直接调用的分析入口，复用同一 crate AST，不承担 hard-rule diagnostic。
- `report module-layout` 是已解析 module tree 的布局自省入口，复用同一 crate
  AST，只报告候选，不承担 hard-rule diagnostic。
- `report zero-field-types [CARGO_INPUT...]`输出`ousia.rust-zero-field-types.v1` JSON。
  Candidate `zero-field-inherent-only-candidate`只覆盖unit、零元素tuple和零字段named struct；
  至少一个production inherent impl（空impl有效）才能进入候选，production derive或trait impl会抑制。
  Type、显式import与alias chain由共享`TypeFactIndex`按cfg guard关联；重叠target、alias cycle/
  无nominal terminal和glob frontier分别输出`type-association-ambiguous`、
  `type-association-unresolved`和`external-glob-not-resolved` warning，并只抑制guard可重叠的相关类型。
  该report不分析value usage，不输出删除或移动建议，不承担hard failure或release gate。
- Checker 自身验证使用 `cargo fmt --check`、`cargo check --locked` 和
  `cargo test --locked`；仓库 release-only `check.rust-checker-self`检查 checker manifest，
  installed manifest的 `check.rust`通过 `check-project .`检查宿主，不保留旧
  `check.rust-functions` alias。
