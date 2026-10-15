# 模型与OCR密钥轮换

`LLM_KEY_ENCRYPTION_SECRET`用于数据库中模型provider API Key和OCR视觉模型API Key的AES-256-GCM封装。`APP_ENV=demo|production`启动要求该secret至少32字符；本地开发可不配置，但这会使非空新密钥以明文保存，不适用于真实敏感数据。

`bun run secrets:rotate`维护两个凭据表，默认只验证和统计，不改数据库。`--apply`在同一个PostgreSQL事务内解开旧封装并以新secret重新加密；任一密文损坏、旧secret不正确或数据库写失败都回滚。空API Key保持为空，不生成伪密钥。日志只输出库名、是否apply及两个表的密钥数量。

## 操作

1. 在受保护环境备份数据库，并保留旧secret用于恢复。先停止API，避免轮换过程中缓存的旧配置与新密文混用。不要停止或删除PostgreSQL持久化卷。
2. 通过权限600的维护环境文件或secret管理器提供当前`DATABASE_URL`、`LLM_KEY_ENCRYPTION_SECRET`、新的`LLM_KEY_ENCRYPTION_SECRET_NEXT`和`ROTATE_DATABASE_NAME`。新的secret须为32–512个无空白字符，且与旧值不同。NEXT只供维护进程使用，不转发给常驻API容器、不提交、不打印。
3. `ROTATE_DATABASE_NAME`填写目标数据库的实际名称；CLI还会查询`current_database()`比较，避免误连。先执行`bun run secrets:rotate`，检查输出中的库名与`applied:false`。
4. 确认目标无误后执行`bun run secrets:rotate --apply`。只有完整成功才会输出`applied:true`。失败返回非零退出码与固定错误，避免数据库/密码内容进入终端记录；先检查目标库、旧secret、NEXT格式与受限数据库诊断。
5. 将常驻API的`LLM_KEY_ENCRYPTION_SECRET`替换为刚才的NEXT，删除维护环境中的NEXT，再启动API。验证provider配置列表、OCR配置和一次受控模型/识别操作；不要为此使用真实合同出网。
6. 成功后按组织策略保管旧secret及加密备份。再次轮换时重新生成NEXT，不能只改环境值而不重封装数据库。

配置secret后，API启动会在一个事务中封装两个凭据表的既有非空明文；再次启动不重写已加密值。未配置旧secret的本地明文数据也可用轮换命令迁移到新secret。已经加密的数据没有旧secret无法恢复；不能通过猜测、清空API Key或默认明文回退掩盖错误。常驻API不得在本轮轮换完成后继续使用旧secret。

## 验证范围

`apps/api/src/llm/rotate-api-keys.test.ts`使用PostgreSQL连接局部临时表，不访问或改写用户的真实密钥。已执行dry-run不变、两表apply后新secret解密一致、旧secret失效、OCR坏密文导致已更新provider回滚以及短NEXT拒绝的9项断言。维护CLI另在全新、已应用全部迁移的隔离数据库完成dry-run/apply、解密值一致和错误库名拒绝；启动明文封装实测首次更新2条、重复更新0条。证据见[密钥轮换实测](../project-management/evidence/key-rotation-smoke.json)和[启动拒绝实测](../project-management/evidence/startup-security.json)，不把这些回归描述成生产恢复演练完成。
