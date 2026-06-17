# Research

Research 保存外部参考、分析笔记、候选方案和 agent review/planning evidence。它帮助决策，但不直接成为长期规范源。root `design/notes/**` 和 legacy agent workflow evidence 只是迁移来源。

## 迁移来源

| 来源 | 角色 |
| --- | --- |
| [notes/reference/](../../../design/notes/reference/) | 外部系统、外部机制和现有技术模式。 |
| [notes/analysis/](../../../design/notes/analysis/) | Ousia 设计分析、候选方案、草案和深挖。 |
| [agent-harness-evidence/](../../../design/implementation/agent-harness-evidence/) | Agent 查证路线、review attacks 和 planning prompts。 |

## Review Focus

- reference 是否只保存外部事实和比较材料，不偷写 Ousia 规范。
- analysis 中的新结论是否已经回写 baseline、architecture 或 execution owning docs。
- review attacks 是否贴着它攻击的设计区域，而不是变成独立 agent checklist。
- residual risk 是否被带回 proposal 或 implementation review。

## 迁入规则

外部事实、候选判断和 agent-only attacks 迁入 research；稳定设计结论迁入 baseline、architecture 或 execution。Review attacks 必须贴着它攻击的设计区域，不能变成独立 agent checklist。
