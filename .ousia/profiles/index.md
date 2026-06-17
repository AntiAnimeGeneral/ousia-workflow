# Ousia Profile Definitions

本目录保存 Ousia-controlled profile definitions。它和 installed adapter instance 同属 `.ousia/**`，但 ownership class 独立：profile definitions 由 Ousia 控制并按 profile version 升级，project facts 进入 installed adapter slots。

## Profiles

| Profile | 入口 | 职责 |
| ------- | ---- | ---- |
| ext-ousia-os | [ext-ousia-os/instructions/](./ext-ousia-os/instructions/) | Ousia OS kernel、OSTD、tooling、validation 和 reference route 规则。 |
| ext-ousia-workflow | [ext-ousia-workflow/instructions/](./ext-ousia-workflow/instructions/) | Ousia Workflow 自身发布、迁移、dogfood、fixture 和升级规则。 |

## 边界

- Profile definitions 只定义 Ousia-controlled slots、读取协议、验证矩阵和项目类型规则。
- Installed adapter facts 进入 `.ousia/design/**`、`.ousia/workflow.json`、`.ousia/pending.md` 或对应 profile-defined slot。
- 不再建立与 `.ousia/**` 并列的 adapter 目录；所有 adapter 责任都通过本目录树路由。