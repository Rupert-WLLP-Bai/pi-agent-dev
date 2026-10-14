# Contract Audit

[CONTEXT.md](./CONTEXT.md) 定义合同与审计的核心术语。这里补充同一审计案件再次分析时的动作概念。

## Language

**Agent Rerun（重新运行 Agent）**:
针对同一审计案件、沿用既有审查快照发起的一次新的 Agent 分析尝试；新的发现追加，已有发现、人工复核和整改记录保留。失败、取消或中断后的重新运行也称为重试。
_Avoid_: 重评、恢复旧会话、从头审计

**Audit Reassessment（重评）**:
针对同一审计案件，按当前生效规则形成新的审查快照后再次进行分析；原快照仍是过去评估依据的记录。
_Avoid_: 重新运行 Agent、重试
