# M1 执行视图快照（切换到 M2 前）

保存日期：2026-10-17。按 [task-management](../../task-management.md) 在重建 OMP/当前执行视图前归档被移出的 M1 关键任务。本文件是历史证据，不是第二份当前任务板。

## 当时全局结论

- M1/v0.7.0 已发布：M1-B01/B02/B03、M1-AUTH01、M1-CI01、M1-GIT01、M1-GIT02 均为 DONE。
- SEC3 认证延期到最后，不阻塞后续 Milestone。
- M2 与 TI 功能开发尚未计作完成；TI 29 项原状态保留。

## 被移出视图的关键任务

| ID | 名称 | 状态 | 映射 |
| --- | --- | --- | --- |
| M1-B01 | 真实浏览器业务闭环 | DONE | 业务闭环验收 |
| M1-B02 | 完整Release Gate | DONE | 发布验收；关联 Q4/Q5 |
| M1-B03 | 发布与交接 | DONE | v0.7.0 Tag 与交接 |
| M1-CI01 | 完善GitHub Actions CI并验证真实运行结果 | DONE | 关联 Q5/M4-A01 |
| M1-GIT01 | 分批将通过验证的改动合入main | DONE | 集成到 main |
| M1-GIT02 | 推送main及发布记录到GitHub并核对CI | DONE | 远端交付 |
| M1-AUTH01 | 移除当前登录口令并将认证延期到最后 | DONE | SEC3 延期 |

## 保留但不进入 M2 执行视图的延期项

| ID | 说明 |
| --- | --- |
| SEC3 | 服务端授权/登录；用户要求最后再做 |

完整状态与证据仍以 [TASK-BOARD](../../TASK-BOARD.md) 为准。
