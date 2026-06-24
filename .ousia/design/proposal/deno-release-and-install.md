# Deno Release And Install

本提案替代早期 Node/npm release installer 切片。新的前提是目标维护环境已经依赖
Deno，且 Ousia 不为 Node/npm 兼容性保留额外架构。

## 目标

- Installer runtime、测试、安装 smoke 和 release gate 统一由 Deno 驱动。
- 提供 Deno CLI：Git checkout 内用 `deno task install` 安装 `ousia`，目标项目使用 `ousia install <target>`。
- Git checkout 是主分发物；`deno task release` 作为质量门，`deno task install` 把本机 CLI 绑定到当前 checkout。
- 默认安装源是安装 CLI 时所在的 Ousia checkout。
- 发布流程验证 checkout install、重复 `deno task install` 更新本机 CLI、fresh install、重复安装、baseline overwrite 和 failure no-side-effect。
- 文档给出用户安装、目标项目更新、发布者 release 和故障处理路径；Deno config、permissions 和 command name 是 checkout task 的内部默认，不暴露给用户手写。

## 非目标

- 不发布 npm 包。
- 不支持 npx、Node-only runtime 或 npm tarball。
- 不引入 install lock、上一版安装数据库、本地编辑追踪或 section merge。
- 不把 Git 的接受、调整和回退职责复制进 installer。
- 不保留 tarball、JSR、Node/npm 或 `deno compile` binary 兼容分发路径。

## 候选方案

- 继续 Node/npm：兼容面更宽，但项目会保留第二套 runtime、npm 打包和 Node-only
  约束；在目标环境已有 Deno 的前提下收益不足。
- Git checkout + `deno task install`：用户通过 Git 获取、更新和回退 Ousia；安装 task 封装 Deno permission/config 细节，CLI 默认读取 checkout source。采用该方案作为第一阶段权威分发物。
- Archive、JSR 或 `deno compile` binary：都会引入第二分发面和额外验证矩阵；当前不保留兼容路径。

## 模块边界

- `src/cli.ts` 是 Deno CLI entry，只负责参数解析、调用 installer 和输出
  human/JSON。
- `src/mod.ts` 是 public module surface。
- `src/source.ts` 拥有 payload collection rules，并继续要求 manifest ownership
  coverage。
- `src/manifest.ts` 拥有 ownership、matched pattern 和 upgrade policy 判断。
- `src/planner.ts` 按 source 和 target 生成 plan，不写文件。
- `src/applier.ts` 拥有 staging、journal、commit、rollback 和 apply
  diagnostics。
- `src/installer.ts` 编排 source、plan、dry-run、blocked、apply 和 report。
- `scripts/install-cli.ts` 封装 `deno install` 的 config、permissions 和 command name 默认值；用户入口是 checkout 内的 `deno task install`。
- `smoke/install-smoke.ts` 验证 Git checkout 默认 source、重复 `deno task install`、安装后 CLI、重复安装和 overwrite。

## 第一实施切片

1. 建立根 `deno.json` 和 Deno task surface。
2. 将 Node/npm package runtime 迁移到 `src/**` Deno modules。
3. 将测试迁移到 `Deno.test` 和 `@std/assert`。
4. 删除 Node/npm package、tsconfig、lockfile 和旧 `packages/ousia/**` runtime
   surface。
5. 重写 payload、pack、install smoke 和 release smoke。
6. 写 `docs/release-and-install.md`，并更新 README 与 Architecture。

## 验证

- `deno task fmt:check`
- `deno task lint`
- `deno task check`
- `deno task test`
- `deno task smoke:install`
- `deno task release`
- `deno task --cwd .github/skills/doc-validation check:docs`
- `git diff --check -- .github .ousia README.md docs scripts smoke src test deno.json`

## Review Focus

- Deno-only 是否真的删除 Node/npm compatibility surface，而不是保留双 runtime。
- Git checkout smoke 是否验证默认 `ousia install <target>` 路径和重复 `deno task install` 更新路径。
- Payload 是否只包含可安装 workflow surface，没有混入 self-hosting policy 或当前
  proposal 正文。
- Installer 是否仍以 `.ousia/workflow.json` 的 `upgradePolicy` 为计划行为权威。
- Applier 是否在失败路径保持无副作用或暴露稳定 rollback failure 诊断。
- 文档是否描述当前使用方式，而不是迁移过程流水。
