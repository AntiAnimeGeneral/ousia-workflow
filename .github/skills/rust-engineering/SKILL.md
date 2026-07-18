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
- 承载独立领域动作的模块级函数调用优先保留 `module::function` 形式，让模块 owner
  和函数动作一起表达完整语义。
- 只有当模块名不承载领域语义、路径只是机械命名空间，或局部辅助逻辑已处在明确
  owner 内时，才把函数导入后用短名调用。

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

## 验证

按项目 workflow route 或 installed adapter facts 选择命令。常见 Rust checks
包括：

- `cargo fmt --check`
- `cargo check`
- `cargo test`
- `cargo clippy`
