# Architecture

Architecture 保存长期稳定的系统抽象、边界和主线契约。它是未来 architecture 正文的目标 owner；root `design/core/**` 和相关 topics 只是迁移来源。

## 迁移来源

| 来源 | 角色 |
| --- | --- |
| [core/](../../../design/core/) | 当前主线架构和长期设计契约。 |
| [topics/00-async-and-mmap.md](../../../design/topics/00-async-and-mmap.md) | 同步、异步、mmap 和缺页边界。 |
| [topics/01-compatibility.md](../../../design/topics/01-compatibility.md) | 兼容域边界和原生接口污染风险。 |
| [topics/04-environment-and-config.md](../../../design/topics/04-environment-and-config.md) | 环境、配置和兼容域库视图。 |
| [topics/05-identity-and-accounts.md](../../../design/topics/05-identity-and-accounts.md) | 身份、密钥、信任和发布者边界。 |

## Review Focus

- 稳定抽象是否有唯一 owner，引用方是否只消费不重定义。
- 跨切面 topic 中已经稳定的设计结论是否应回写到 architecture owning docs。
- 兼容层、POSIX、VFS、file/path 等概念是否污染 Ousia 原生 API。
- 同步和异步是否都保持 first-class。

## 迁入规则

稳定架构结论迁入本区域；研究、候选方案和外部参考不直接进入本区域。迁移未完成前，legacy docs 可以继续承载正文，但新增结论必须能指向本区域的 owner。
