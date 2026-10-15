# 工作区访问与模型数据边界

本系统提供单工作区共享口令门禁。它保护审计记录、合同原件、SSE、规则与模型配置、影子建议；不提供个人账户、角色授权、SSO或多租户隔离。

## 启动与登录

设置随机、无空白的`API_ACCESS_TOKEN`，长度32–512字符。`APP_ENV=demo|production`必须配置；`development|test`可不配置，仅适用于可信本机。通过受保护的本地环境文件或容器secret注入，权限设为600，不写入仓库、URL或日志。API和Web应通过同一站点或开发代理访问。

- `GET /api/session`返回`{authenticationRequired,authenticated}`。健康检查与会话入口无需凭证。
- `POST /api/session`提交`{token}`，成功创建8小时HttpOnly、SameSite=Strict Cookie `audit_session`。production设置Secure，须使用HTTPS。错误口令返回401。
- `DELETE /api/session`返回204，服务端撤销该会话并清除Cookie。捕获旧Cookie也不能在登出后再次访问。
- 自动化客户端可通过`Authorization: Bearer <token>`访问。不要把口令放入查询参数。`X-Operator`只用于操作归属记录，不能授权。

Cookie中是随机会话标识，服务端仅保存其SHA-256摘要。应用重启会撤销全部会话；同时最多256个有效会话。该实现仍要求单应用实例，不能声称跨副本会话一致。替换`API_ACCESS_TOKEN`后重启API可轮换访问凭证并撤销旧会话。浏览器不在localStorage保存口令。

跨站写入拒绝非本站点且不匹配配置`WEB_ORIGIN`的Origin。`WEB_ORIGIN`须固定为实际受控Web源。部署仍应限制网络入口并终止HTTPS；共享口令持有人拥有整个工作区权限。

## 访问日志

`api_access`记录请求关联ID、HTTP方法、路由模板、状态、耗时和是否通过门禁。不记录请求体、原文、Authorization/Cookie、查询参数、资源ID或模型密钥。未知路由以`<unmatched>`记录。日志由部署端限制读取，按组织留存策略轮转；应用不把日志另存入业务审计表。业务复核与整改历史继续使用已有追加记录，访问日志不能替代业务记录。

轨迹持久化、主体核验缓存和Redis连接失败只输出固定事件码；轨迹日志可包含run ID与步骤序号。底层错误对象可能携带SQL参数、合同片段或连接凭据，因此不直接打印。可选Redis使用1.5秒连接超时并关闭自动重连；首次连接失败返回禁用缓存，主体核验继续直连，恢复Redis后重启API恢复缓存。实际不可达端口smoke与隐私回归见[缓存故障证据](../project-management/evidence/cache-failure-smoke.json)。

## 模型数据

`LLM_INTERNAL_DATA_ORIGINS`是允许处理原始内部合同的精确origin列表，逗号分隔，默认空。必须包含协议、主机及实际端口，不能附带`/v1`路径、查询、用户凭据或fragment。例如受控私有服务可填`https://model.intranet.example:8443`。该设置是管理员的数据处理授权，不是供应商隐私能力证明。

loopback网关本身可能再转发到外部，因此`http://127.0.0.1:3425`不会自动取得处理真实合同的权限。默认仅放行内容hash与内置合成合同目录匹配的文档；服务端重新计算规范文本hash，不接受调用者伪报的DEMO标记或hash。附带真实外部核验或历史人工复核数据时，不享有合成文档豁免。被拒绝时返回稳定执行错误`MODEL_DATA_OUTBOUND_FORBIDDEN`，不发送模型请求。

真实Pi演示使用指定网关`http://127.0.0.1:3425/v1`与模型`panda-local/cqmoma/cqcm/deepseek-v4-flash`，只发送未修改的标准合成合同。Pi模型HTTP请求禁止重定向；配置的模型地址不能把合同和工具输出带往另一origin。Laya使用独立本地origin允许列表、最小脱敏输入、明确来源和未校准标记，规则与正式发现的权限保持独立。

## 已执行验证

S2门禁切片已执行7项行为测试，涵盖匿名读取拒绝、Bearer、登录、Cookie保护属性、过期/伪造、登出撤销、跨站写入拒绝和日志字段。另使用真实HTTP监听与独立已迁移PostgreSQL验证：匿名案件列表401，会话发现200，登录200，授权案件列表200，登出204，撤销Cookie重放401。完整集成、浏览器及部署验收由S3报告提供；这里不把共享口令描述成生产身份治理完成。
