---
applyTo: "**"
description: "跨语言工程硬规范：调用边界、唯一 owner、失败前置检查、语义稳定、抽象有效性和测试证据。"
---

# 工程规范

- 非平凡修改前先读取直接调用方、依赖与被依赖模块和相关测试；开始实现前应能说明输入、输出、状态
  owner 与失败 owner。
- 现有模式是
  evidence，不是法律。保持未改变的行为与代码形状，不夹带无关重排、改名、清理或风格统一。
- 编排、可变状态、校验、归一化、默认值、错误映射和副作用必须各有可命名的唯一
  owner；高层策略不得反向依赖底层细节。
- 每个非局部函数或可调用行为必须属于可命名的领域、编排、模型、校验、配置、诊断、
  adapter 或副作用 owner；局部私有 helper 只能服务相邻 owner，不得形成第二套隐式
  API 或进入无语义的通用容器。
- 一方模块的跨模块调用必须在调用点显露语义
  owner，并按成熟第三方库的标准提供可发现、 窄而稳定的调用面；不得用裸导入、聚合
  re-export 或 `utils/common/helpers` 隐藏来源。实例、trait/interface
  方法和局部私有 helper 遵循语言惯例，外部依赖遵循其公开 API。
- 所有可能由外部输入触发的可恢复失败检查必须先于状态提交和外部副作用；失败不得留下部分状态。
- 抽象必须保存当前语义、隔离真实变化或集中副作用；不得引入薄包装、空扩展点、隐式
  fallback、投机 placeholder 或伪兼容层。
- 有意保留的临时实现、stub、placeholder、降级路径或跳过分支必须在最近位置使用
  `TODO(scope): reason; exit condition`：scope、当前不可依赖语义/验证缺口、最终
  owner 和完成或删除所需 evidence
  都必须可识别；完成时同步删除标记。普通注释、静默 fallback
  或抽象命名不能代替该协议。
- 行为变化必须提供穿过真实调用边界的测试
  evidence，并证明相关失败不变量；测试设计、层级和 fixture 规则归
  `test-engineering`。
- 用户目标与仓库硬约束、安全/正确性边界或 compatibility
  语义实质冲突时先澄清，不得静默偏移。

详细工程 evidence、smell、reference 使用和 review attacks 归
`engineering-quality`；本 instruction
不规定目录、分层命名、技术栈、测试框架或语言特定实现形状。
