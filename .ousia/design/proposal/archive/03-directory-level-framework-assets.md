# 03 Directory-Level Framework Assets

## 用户目标

`framework.json` 中源码类 asset 不应继续按每个 `.ts` 或 `.rs` 文件维护。Rust
checker 和 Deno doc checker 都有清楚的语言项目边界：Rust checker 是 Cargo
project 目录，Deno doc checker 的源码根是 tool package 的 `scripts/`。Manifest
应表达这种目录级 owner，而不是把目录重新展开成文件 ID 清单。

## 纠偏

前一版 `install.assetBundles + idMappings` 方案不采纳。它把源码目录包装成
bundle， 但仍要求每个文件有独立 asset ID、digest 和 retirement
membership；新增源码文件仍要修改 manifest
mapping。本质上它只是逐文件清单的压缩格式，不是真正的目录管理。

真正的目标是：**目录 asset 是一个可替换单元**。目录像一个文件 asset 一样拥有单一
ID、单一 target、单一 digest 和单一事务边界；目录内部文件变化只改变 tree
digest，不改变 manifest identity。

## 背景与约束

- 当前 installer pipeline 以文件 `InstallAsset` 为事务单位：source
  digest、target precondition、rollback 和 manifest-last 都围绕单个 target
  路径工作。
- Rust checker `.github/skills/rust-engineering/checker` 是 Cargo project
  边界，应作为单一 directory asset；`target/` 是构建产物，必须从 asset tree
  中排除。
- Deno doc checker 的 `deno.json` / `deno.lock` / `tsconfig.json` 是 tool
  根配置，应继续作为显式文件 asset；`scripts/` 才是目录 asset。
- Compatibility: `required`。已安装目标项目可能保存旧版逐文件 Rust checker
  source membership；新目录 asset 必须能安全接管旧 framework-owned
  文件，不能接管 project-owned 文件或 project fact slot。

## 目标

- Manifest 支持 framework-owned tool directory asset。
- Directory asset 以目录树为 source 和 target，拥有单一 asset ID。
- Source snapshot 为目录计算 deterministic tree digest。
- Planner 以目录 target 为 plan item，比较 target tree digest 后决定
  create、identical、replace 或 conflict。
- Applier 对目录执行事务：staging/new tree、backup old tree、rename
  commit、rollback restore。
- 旧逐文件 framework asset 被新目录 asset 覆盖时，允许作为 compatibility
  接管，不要求每个旧文件 tombstone。
- Project-owned asset、project fact slot、unknown target 或 symlink/special file
  不能被目录 asset 覆盖。
- 首次从逐文件 asset 迁移到 directory asset 时，目录内未知 child entry 必须
  conflict；只有旧 manifest 已记录同一 directory asset 时，目录 target
  才被视为排他 framework-owned 边界。

## 非目标

- 不为目录内部文件分配 asset ID。
- 不为目录内部文件记录单独 tombstone。
- 不把 prompt instruction、skill、project seed 或 `.ousia/framework.json`
  做成目录 asset。
- 不裸扫任意工具根；目录 asset 必须显式声明 source/target 目录。
- 不引入旧 schema adapter、双写 manifest 或兼容 facade。
- 不自动安装语言依赖，也不解释 Cargo、Deno 或 package manager 语义。

## 候选方案

### 方案 A：继续逐文件 manifest

风险最低，但继续要求新增源码文件同步改 manifest、smoke 和测试清单，不能解决
owner 粒度偏差。不采纳。

### 方案 B：bundle 展开为逐文件 assets

该方案保留现有 planner/applier 结构，但 `idMappings` 会把目录内部重新变成文件级
ownership。 它降低 JSON 行数，却没有降低维护语义复杂度。不采纳。

### 方案 C：目录 asset 作为可替换单元

该方案需要扩展 planner/applier 的事务模型，但语义与用户目标一致：目录拥有一个
ID、一个 target、一个 digest 和一个 rollback 边界。推荐采纳。

## 推荐模型

扩展 `InstallAsset`，新增目录形态。字段可以是显式 discriminator，例如：

- `shape: "file" | "directory"`，现有 asset 缺省为 `file`。
- directory asset 只允许
  `kind: "tool"`、`ownership: "framework"`、`update: "replace"`、`retire: "delete"`。
- directory asset 的 `source` 和 `target` 必须是目录路径，不能是 glob。
- directory asset 禁止 `native` 和 `projectFactSlot`。

第一批 Rust checker 迁移：

- 新增 `tool.rust-checker` 目录
  asset：`.github/skills/rust-engineering/checker`。
- `tool.rust-checker` 声明 `exclude: ["target"]`，不管理 Cargo build output。
- 删除旧的 `tool.rust-checker-*` 文件和 `tool.rust-checker-src` 目录 asset
  声明，不为它们添加 tombstone；由 compatibility 接管规则解释。

Doc-validation checker 迁移：

- `tool.docs-deno`、`tool.docs-lock`、`tool.docs-tsconfig` 保持文件 asset。
- `tool.docs-scripts` 目录 asset 管理 `.github/skills/doc-validation/scripts`。

## Tree Digest

目录 digest 必须 deterministic，覆盖目录内所有普通文件的相对路径和
bytes。建议输入包含：

- 每个文件的 POSIX 相对路径。
- 文件 bytes 的 sha256。
- 稳定排序后的 entry 列表。

目录 digest 不包含 mtime、权限、平台 inode 或遍历顺序。Source 和 target digest
使用同一算法。

目录 source 和 target 内不得包含 symlink 或特殊文件；发现即失败。目录 target
如果是普通文件、symlink 或特殊文件，planner 产生 conflict，而不是删除重建。

## Planner 语义

Directory `PlanItem` 仍对应单一 target 路径，但需要能表达 directory action。

- source directory missing 或非目录：source validation fail。
- target missing：create directory。
- target directory tree digest 等于 source tree digest：identical。
- target directory tree digest 不同：replace directory。
- target 是文件、symlink、特殊文件：conflict。
- target 被 old project fact slot 覆盖：conflict。
- old project-owned asset 位于新 directory target 下：conflict。
- old framework-owned file asset 位于新 directory target 下：允许由 directory
  asset 接管，不要求 tombstone。
- 旧 manifest 已记录同一 directory asset：该 target 目录是排他 framework-owned
  边界，目录 tree digest drift 可规划为 replace。
- 旧 manifest 未记录同一 directory asset：planner 必须枚举现有 target
  目录；任何不属于旧 framework-owned file membership 接管集合的 child entry 都是
  unknown child conflict，即使相同相对路径也存在于新 source tree。
- old framework-owned file asset 不在任何新 active asset 或 directory asset
  下：仍要求 tombstone。

Manifest-last 保持不变：`.ousia/framework.json` 的 mutation 必须排在目录
create/replace/delete 之后。

## Applier 语义

Applier 继续是唯一 filesystem side-effect owner。目录事务应复用现有 staging /
backup / rollback 精神，但以目录树为单位：

- create：将 source directory 复制到 staging/new，然后 rename 到 target。
- replace：先验证 target tree digest precondition，把旧 target directory rename
  到 staging/backup，再把 staging/new rename 到 target。
- rollback：如果后续 mutation 失败，删除仍由事务创建的新 target，恢复 backup
  directory。
- identity/digest drift：如果 target 或 backup 在事务中被外部改变，进入
  recovery-required，不静默覆盖。

复制目录时必须拒绝 source symlink、特殊文件和路径逃逸。创建出的 target
目录只包含 source tree 中的文件。 旧目录中不在 source tree
内的文件只有在以下场景才能随目录替换删除：旧 manifest 已记录同一 directory
asset，或该文件属于被新 directory asset 接管的旧 framework-owned file
membership。其他 extra child entry 必须在 planner 阶段 conflict，不能交给
applier 删除。

## 兼容与迁移

旧 target manifest 可能仍列出 Rust checker
`src/**/*.rs`、`Cargo.toml`、`Cargo.lock` 的逐文件 framework assets，或上一版
`tool.rust-checker-src` directory asset。新 source manifest 用
`tool.rust-checker` directory asset 后：

- planner 识别旧 framework file target 位于新 directory target 下，视为
  directory asset 接管。
- 不要求这些旧 file asset tombstone。
- 如果旧 target 中对应路径已被用户修改，目录 replace 会以 directory tree digest
  处理，而不是逐文件保留。
- 如果旧 target 中存在未被旧 framework file membership
  覆盖的新增文件或目录，planner 必须报告 unknown child
  conflict；用户手动新增但未进入旧 manifest 的 Rust source 文件不被静默视为
  framework-owned。
- 如果旧 target 中出现 project-owned asset 或 project slot
  覆盖目录内部路径，planner 必须 conflict。

这不是旧 schema adapter；它是同一 install planner 对旧 membership evidence
的兼容解释。

## 实施切片

1. Schema 与模型。
   - 为 `InstallAsset` 增加 file/directory shape。
   - directory asset 只允许 framework-owned tool replace/delete。
   - 校验 directory target 不与 file target、project slot、retired target
     形成非法前缀冲突。

2. Source snapshot 和 tree digest。
   - 增加 directory source 读取模型。
   - 计算 deterministic tree digest。
   - 拒绝 source symlink、特殊文件和路径逃逸。

3. Planner directory action。
   - 支持 target directory digest 比较。
   - 支持旧 framework file assets 被新 directory asset 覆盖的 compatibility
     解释。
   - 保持 project ownership 与 project fact slot conflict。
   - 保持 manifest-last。

4. Applier directory transaction。
   - staging/new directory copy。
   - backup/restore directory rollback。
   - source-plan mismatch 和 target precondition 仍在 mutation 前复验。

5. Rust checker 迁移。
   - 将 `checker` Cargo project 迁为 directory asset。
   - 排除 `target/` 构建产物。
   - 更新 smoke，从“每个 Rust source 文件都在 manifest”改为“目录安装后 checker
     可运行”。

6. Architecture handoff 与 review。
   - 实施通过后回写 Architecture。
   - 使用 implementation review 攻击目录 digest、rollback、project ownership
     和旧逐文件 membership 兼容。

## 验收矩阵

| 目标状态                         | Evidence                                                                            |
| -------------------------------- | ----------------------------------------------------------------------------------- |
| 目录 digest 稳定                 | source/planner tests 覆盖路径排序、文件 bytes 变化和新增/删除文件                   |
| 目录只接受普通文件               | source tests 覆盖 symlink、特殊文件和 symlink escape                                |
| planner 支持目录 create/replace  | planner tests 覆盖 missing、identical、drift、target type conflict                  |
| applier 支持目录事务             | applier tests 覆盖 create、replace、rollback、source-plan mismatch 和 staging guard |
| 旧逐文件 framework assets 可升级 | planner/installer tests 覆盖旧 Rust checker file membership 被目录接管              |
| project ownership 不被目录接管   | planner tests 覆盖 old project asset/slot 位于目录下时 conflict                     |
| unknown child 不被静默删除       | planner tests 覆盖迁移目录中 extra child entry 触发 conflict                        |
| manifest-last 保持               | planner/applier tests 覆盖目录 mutation 先于 manifest commit                        |
| Rust checker 安装完整            | smoke install 后运行 Rust checker self-check                                        |
| 文档协议保持有效                 | `deno task --cwd .github/skills/doc-validation check:docs`                          |
| release gate 通过                | `deno task release`                                                                 |

## Review Focus

- Directory tree digest 是否稳定且跨平台。
- Directory replace 是否可能删除 project-owned 内容。
- 旧逐文件 framework membership 是否只在新 directory target 覆盖范围内免
  tombstone。
- Applier rollback 是否能恢复整个目录，且不删除事务外变更。
- Staging guard 是否能在 Linux inode 复用时识别 namespace replacement，并在
  delete 分支副作用前失败。
- Manifest-last 是否仍在目录 mutation 后提交。
- Source/target symlink 和特殊文件是否在副作用前失败。
- Directory asset 是否只用于 framework-owned tool source，没有扩散到
  prompt/project facts。

## 关闭条件

该 proposal 只有在以下条件成立后才能归档：

- Rust checker Cargo project directory asset 已实施并通过 validation。
- 旧逐文件 Rust checker target manifest upgrade 已有测试 evidence。
- Directory create/replace/rollback 已有 applier 测试 evidence。
- Architecture 已记录 directory asset 与 file asset 的稳定边界。
- Implementation review 无阻塞 finding。
- `deno task release` 通过。

## 关闭结局

已实施并归档。后续边界纠偏将 Rust checker 从 `checker/src` directory asset
上移为 `.github/skills/rust-engineering/checker` Cargo project directory asset；
`Cargo.toml`、`Cargo.lock` 和 `src/**` 共同归 `tool.rust-checker`，`target/` 被
asset exclude 排除。Doc-validation checker 的 `scripts/**` 已收敛为
`tool.docs-scripts` directory asset，tool 根配置仍由 file assets 管理。
`src/source.ts`、`src/planner.ts` 和 `src/applier.ts` 分别拥有 directory tree
snapshot/digest、目录规划与兼容冲突、目录事务提交和 rollback。

关闭 evidence：

- `deno task release` 通过，覆盖 fmt、lint、type check、workflow manifest、Rust
  checker、Deno tests、doc-validation 和 install smoke。
- Deno tests 覆盖旧逐文件 framework membership
  接管、旧嵌套文件父目录接管、unknown file/empty directory child
  conflict、project slot child conflict、directory rollback、source snapshot
  tree digest 和 doc-validation scripts directory asset。
- Applier tests 覆盖 staging namespace replacement：随机 sentinel guard 防止
  Linux inode 复用绕过 identity check，delete 分支在目标移动前返回
  recovery-required。
- Architecture 已记录 directory asset 稳定边界和 Rust checker Cargo project
  ownership、doc-validation scripts ownership。
- Implementation review 最终结论：未发现需要阻塞合入的问题。
