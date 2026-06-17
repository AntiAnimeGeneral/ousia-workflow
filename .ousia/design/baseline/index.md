# Baseline

Baseline 保存项目为什么存在、目标是什么、需求从哪里来、术语如何稳定。它是所有设计区的共同入口，不承载实现路线或候选方案细节。

## Project Facts

- Ousia Workflow 是一个可安装、可升级的 agent workflow 框架。
- Ousia Workflow owns structure, lifecycle, validation, and agent reading protocol.
- Projects own facts inside Ousia-defined slots.
- Adapter/profile architecture is Ousia-controlled; project payload is not a freeform overlay.

## Review Focus

- 新增抽象是否能回溯到需求或明确痛点。
- 术语是否只在 glossary 中定义一次。
- target 是否保持摘要入口，没有吸收完整需求库或实现路线。
- requirements 是否保存硬需求和推导，而不是主设计正文。

## 填充规则

稳定 baseline 结论进入本区域后，跨区域引用只链接，不重写。新增结论必须能明确归到 Baseline、Architecture、Execution 或 Research；不能归属时进入 pending。
