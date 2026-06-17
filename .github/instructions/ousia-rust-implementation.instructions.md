---
applyTo: "**/*.rs,Cargo.toml,.cargo/**"
description: "Rust 实现规范：API 误用防护、状态机、match 完整性、常量、导入和 panic/unwrap 边界。"
---

# Rust 实现规范

处理 Rust source、Cargo metadata 或 Rust API 设计时使用这些规则。通用实现质量、性能和错误边界以 `.github/instructions/ousia-implementation-quality.instructions.md` 为权威；本文只规定这些规则在 Rust 中的语言投影。

## API 和状态

- Rust API 应以调用者不易误用为目标：用类型系统承载边界和不变量，用清晰的 enum/newtype/Result 表达状态与失败，用所有权和借用关系表达可变状态归属。不要为了贴近 C API 外形而保留参数堆叠、裸整数语义、隐式输入顺序或容易混淆的调用面。
- Rust 状态机、权限判断、能力类型、对象类型和架构分支应优先使用显式 enum match。不要用 `_` 或 wildcard fallback 吞掉未来新增状态，除非该 fallback 本身就是经过设计的兼容语义，并且有测试覆盖。
- Rust 中有语义的 magic number 应使用常量。
- 同一模块内可以通过 `use` 引入需要频繁使用的类型、trait、常量和构造器，避免在函数签名和主路径中反复写长限定路径。
- 承载独立领域动作的模块级函数调用应优先保留 `module::function` 形式，让模块 owner 和函数动作一起表达完整语义。不要把 `mem::swap` 这类语义函数直接引入为裸 `swap`，除非当前作用域已经由同一 owner 明确包围，且短名不会丢失对象语义。
- 只有当模块名不承载领域语义、路径只是机械命名空间，或局部函数/闭包/私有辅助函数已经处在明确 owner 内时，才把函数导入后用短名调用。

## Panic 和 Invariant

- 只有失败完全不可能发生、且该假设未来可以自然替换为 unchecked assumption 时，才使用 `unwrap`；必要时用短注释说明不可失败原因。
- 只有错误的内部调用、错误的 API 使用或内部 invariant 破坏才会触发，而正确调用不会触发时，才使用带语义说明的 `expect` 或 invariant assertion。
- 如果校验函数已经建立 invariant 并返回后续需要的数据、引用、索引、句柄或提交计划，应直接消费该返回值；不要再次查找后用 `expect` 取同一个事实。
- 可能由外部输入触发的失败不能靠 `expect` 处理。
