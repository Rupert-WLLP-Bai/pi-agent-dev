# 对象存储（RustFS）配置与行为

本页描述原件存储的配置、严格/回退两种模式、路径与桶的约束、超时与错误语义，以及尚未实测的部分。

## 1. 拓扑

```text
上传 → saveOriginal() → 先落字节 → 同一事务登记 source record / 合同修订 / 案件（含 locator） → 入队
下载 ← readOriginal(locator) ← Source Record.original_path
```

`original_path` 是唯一的事实来源，两种形态：

- `s3://<bucket>/<key>`：对象存储；
- 文件系统路径：本地目录（未配置对象存储，或开发环境显式回退）。

`GET /api/audit-cases` 与案件详情返回的 `originalStorage` 由该前缀推导（`s3` / `local`），
健康检查 `/api/health` 的 `objectStore` 行报告当前生效的后端与失败策略。

## 2. 配置

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `S3_ENDPOINT` | 空 | 留空即使用本地目录，这是正常的本地状态，不是错误 |
| `S3_BUCKET` | `contract-originals` | 桶名；compose 中由 `rustfs-init` 幂等创建 |
| `S3_ACCESS_KEY` / `S3_SECRET_KEY` | compose 本地默认 | 生产必须显式提供，不写入仓库 |
| `S3_REGION` | `us-east-1` | RustFS 兼容任意值，但必须与客户端一致 |
| `S3_STRICT` | `demo`/`production` 为 `true`，其他为 `false` | 见下节 |
| `S3_TIMEOUT_MS` | `10000` | 单次对象存储请求上限；0 或留空表示不设客户端超时 |
| `UPLOAD_DIR` | `var/uploads` | 本地回退目录 |

## 3. 严格模式与回退

`S3_STRICT` 决定**写入失败意味着什么**：

- **严格（`true`，demo/production 默认）**：Put 失败即本次上传失败（HTTP 500）。不会把字节写到本地
  磁盘却留下 `s3://` 的 locator——那是一种事后无法解释的状态。
- **回退（`false`，仅开发环境显式选择）**：Put 失败时写入本地目录，避免对象存储故障阻断审计。
  读取仍按 locator 的方案分派，因此写在 S3 的行不会被悄悄改从磁盘读。

判定顺序：显式 `S3_STRICT` 优先；未显式设置时按 `APP_ENV` 取默认。该判定在每次读取配置时重新计算，
不缓存进程启动时的值。

## 4. 路径与桶约束

- **本地读取按真实路径判定包含关系**：两侧都取 `realpath`，因此符号链接指向的 `UPLOAD_DIR` 正常工作，
  而仅共享前缀的兄弟目录（`var/uploads-evil`）会被拒绝。目标文件已被删除时，按最深的已存在祖先判定，
  使穿越尝试仍被拒绝，而不是被误报为“文件不存在”。拒绝码：`ORIGINAL_PATH_OUTSIDE_UPLOAD_DIR`。
- **对象键由 Source Record id 与扩展名构成**（`<uuid><ext>`），不采用用户文件名，因此文件名无法影响键。
- **失败清理只删除本次写入的那个对象**：`removeOriginal(locator)` 校验 locator 指向本部署已配置的桶，
  否则拒绝；删除失败时返回 false，调用方必须记录可恢复的孤儿对象，**不得**声称清理成功。

## 5. 错误语义

| 情况 | 行为 |
| --- | --- |
| 对象不存在 | 下载返回 404 `original_missing`；粘贴文本提交返回 404 `no_original` |
| 无访问权限 | 读取失败并记录稳定错误码，不伪装为空文件 |
| 请求超时 | 由 `S3_TIMEOUT_MS` 触发，记录为超时而非成功 |
| 登记失败（Put 之后） | 删除本次写入的对象；删除失败则记录孤儿并让请求失败（500） |
| 未配置对象存储 | 本地目录后端；健康行显示本地路径 |

日志只写稳定错误码与错误名（`describeStorageError`），不写原始 SDK 错误对象——后者可能携带 endpoint、
request id 与桶/键。

## 6. 上传大小与类型

- `MAX_UPLOAD_BYTES`（默认 10485760）在**任何解析之前**拒绝超大上传（413）。
- 类型校验以线上声明的 part MIME 为准（multipart 解析器会按扩展名改写 `file.type`，不可信）；
  扩展名与声明类型不符返回 422。

## 7. 备份与恢复

原件字节**不参与**数据库备份/恢复：locator 在恢复后的副本中仍指向同一个桶，因此不需要复制。
`scripts/demo/backup-restore.ts` 只处理数据库，恢复目标必须是全新的库名（详见 `demo.md`）。
桶的删除不在任何脚本的范围内。

## 8. 尚未实测

以下项目需在集成环境实际执行后记录证据，本页不预设结论：

- 真实 RustFS 的 Put/Get/Delete/HeadBucket 往返与字节一致性（哈希比对）。
- 重启 RustFS 后的持久化读取。
- 凭据错误、桶不存在、对象缺失、超时四类错误在真实服务上的实际表现。
- 严格模式下停止 RustFS 后上传确实返回 500 且本地目录未出现新文件。
