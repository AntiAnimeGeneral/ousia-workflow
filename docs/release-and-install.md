# Ousia 发布与安装

Ousia Workflow 以 Git checkout 分发。目标环境需要安装 Deno；项目不提供 npm、npx 或 Node-only 兼容入口。

## 安装 CLI

拉取 Ousia workflow 仓库并安装本机 CLI：

```sh
git clone <ousia-workflow-repo>
cd ousia-workflow
deno task release
deno task install
```

`deno task install` 会安装或更新本机 `ousia` 命令，并封装 Deno config、权限和命令名。它可以反复运行；每次运行都会用当前 Git checkout 覆盖更新本机命令。安装后的 `ousia` 命令默认从这个 Git checkout 读取 workflow source，因此不要删除或移动该 `ousia-workflow/` 目录；需要移动时重新运行 `deno task install`。

更新本机 CLI 和 workflow baseline：

```sh
cd ousia-workflow
git pull
deno task release
deno task install
```

这就是 Ousia 自身的更新流程：Git 负责获取新版本，`deno task install` 负责把本机 `ousia` 命令重新指向当前 checkout。

## 安装到目标项目

先 dry run：

```sh
ousia install <target> --dry-run
```

需要机器可读输出时使用 JSON：

```sh
ousia install <target> --dry-run --json
```

确认 plan 后执行安装：

```sh
ousia install <target>
```

默认安装源是安装 CLI 时所在的 Ousia Git checkout。

## 更新目标项目

重复运行同一条安装命令即可更新 Ousia baseline。`ousiaOwned` 和
`ousiaStructuredProjectFilled` 路径按 `.ousia/workflow.json` 的
`replace-baseline` 更新；`projectOwned` 和 `localOverrides` 不由 installer
改写。

常规更新流程：

```sh
cd ousia-workflow
git pull
deno task release
deno task install
cd /path/to/target-project
ousia install .
```

Installer 不保存上一版安装状态，不判断用户是否改过 baseline
文件，也不做三方合并。目标项目用 Git 决定接受、调整或回退 baseline 更新：

```sh
git diff
```

## 发布流程

Git 分发下，release 是质量门：

```sh
deno task release
```

它会执行格式、lint、type check、测试和 checkout install smoke。通过后，提交并推送 Git 变更即可分发。

## 故障处理

- `--json` 输出包含 `phase`、`code`、`severity`、`message` 和 `remediation`。
- `apply-parent-blocked`
  表示目标父路径被普通文件阻塞，需要调整目标项目路径后重试。
- `apply-target-changed` 表示 plan 后目标路径出现新文件；重新 dry run 并检查 Git
  diff。
- `apply-rollback-failed` 表示回滚也失败，必须用目标项目 Git diff
  检查并手动恢复。
