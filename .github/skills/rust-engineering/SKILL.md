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
  必填；该 marker 只适用于 `impl` 方法，不适用于模块函数、trait item
  或外部块项。
- `impl` 方法、trait item、trait default method、extern block item
  和宏展开产物不属于第一版检查范围。

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
- 使用普通注释作为 owner marker；checker 只接受可编译的 Rust `doc` attribute。
- 使用未知 `ousia:` marker，或把 ownerless function marker 放到非函数项上。

Review Rust diff 时必须检查：新增模块级函数是否有模块 owner；ownerless marker
是否真的必要且有 reason；inline module 是否继承或声明正确 owner；checker
是否纳入 validation route 和 release gate。

Checker 分两类入口：`check` 输出 diagnostic 并用非零退出码阻断；`report` 输出
review 发现但不拥有硬失败语义。两者共享 `syn` crate AST。

Rust checker hard rules 作为可管理规则族维护：共享 AST 遍历、module context 和
diagnostic sink 归 checker `engine` / `engine::context`；单条规则语义归 `rules/*` 中的唯一
rule owner。新增或修改 hard rule 必须同时具备 stable diagnostic code、触发输入、
允许/禁止语义、正例测试、必须报告的反例测试、skill
文档和验证路线。不要为了规则增长 引入动态 plugin registry、空 hook 或薄
wrapper；只有规则需要 type information、macro expansion 或 rustc HIR
时，才重新评估 Dylint / rustc lint 级工具链。

## Checker 使用

- CLI
  形状：`check [paths...]`、`report function-usage [paths...]`、
  `report module-layout [paths...]`。省略子命令等价于 `check .`。
- `[paths...]` 可传一个或多个 `Cargo.toml`、目录或 `.rs` 文件；`Cargo.toml` 按
  Cargo metadata 读取 targets 并沿 out-of-line module tree 展开，目录和 `.rs`
  文件按文件系统路径检查。
- `check` 退出码非零表示 hard rule 失败；按 diagnostic code 修复 owner
  marker、scope 或 placement 后重新运行同一输入。
- `report` 必须带具体 report 子命令。`report function-usage [paths...]`
  输出 TSV：`used_by_functions`
  是唯一调用方函数数量，`target` 是唯一 Cargo target 或 source root
  标识，`function` 是被调用函数，`callers` 是逗号分隔的调用方函数，`location`
  是函数定义位置；输出按 `used_by_functions` 全局降序排列。
- `report function-usage` 的被调用方只统计同一解析 crate/module tree
  内的模块级函数； 调用方统计模块级函数、`impl` 方法和 trait default method
  中的直接调用。支持 `crate`、 `self`、`super`、`Self` 路径和显式 `use`
  导入；为分析历史或外部代码，report 可以解析 rename import，但 `check` hard
  rule 不允许新增 alias。不分析接收者方法调用、trait dispatch、宏展开产物 或跨
  crate usage。它只用于 review 分析，不作为 release gate 或 hard-rule evidence。
- `report module-layout [paths...]` 输出 TSV：`target`、`module`、
  `current_path`、`recommended_path`、`kind` 和 `reason`。该入口只报告实际解析到的
  `mod.rs` 模块作为 Rust 2018 layout 自省候选；`#[path]` 指向的 `mod.rs` 必须人工
  review。`mod.rs` 不是 hard rule，checker discovery 必须继续支持合法的
  `mod.rs` 布局。
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
- `check` 输入可以是 Rust source 文件、目录或 `Cargo.toml`；`Cargo.toml` 走
  Cargo metadata targets，并沿 out-of-line `mod` 展开 crate tree。
- `report function-usage` 是模块级函数被所有可命名 callable
  直接调用的分析入口，复用同一 crate AST，不承担 hard-rule diagnostic。
- `report module-layout` 是已解析 module tree 的布局自省入口，复用同一 crate
  AST，只报告候选，不承担 hard-rule diagnostic。
- Checker 自身验证使用 `cargo fmt --check`、`cargo check --locked` 和
  `cargo test --locked`，manifest 中的 `check.rust-functions` 负责向 installed
  Rust project 暴露运行入口。
