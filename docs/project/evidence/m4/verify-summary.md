# M4 verify 摘要（本分支）

日期：2026-10-17。分支：`cursor/m2-v080-startup-5ade`。

## 本机命令结果

| 命令 | 结果 |
| --- | --- |
| `bun run lint` | 通过 |
| `bun run typecheck` | 通过（app + tests tsconfig） |
| `bun --env-file=.env test apps/web/src` | 95 pass / 0 fail |
| `bun run verify` | **824 pass / 27 skip / 0 fail**（851 tests / 91 files，≈25.9s） |
| `bun scripts/decision/evaluate.ts`（fake） | 60/60 answered；见 `../m3/decision-evaluate-fake.json` |

`verify` = lint + typecheck + `bun test packages apps`。27 skip 为环境依赖（如不可达 PG）的惯例跳过，非失败。

## 继承的 M1 闸门（可复用，非本分支重跑）

- 单元 835 / 集成 14 / 浏览器 48 / 覆盖层 835，0 fail；行≈80.48% / 函数≈80.32%；分支 N/A  
- 证据：`docs/project/evidence/m1/release-gate-2026-10-17.json`

## 限制

- 本摘要不替代隔离 TEST 上的四层 `test:all` 与 Playwright 多视口双主题截图归档。
- SEC3 认证未纳入。
- M3-B01 专家 gold 未纳入。
