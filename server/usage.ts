import type { ShortsDatabase } from './db.js'
import { DomainError } from './domain.js'

export class UsageLedger {
  constructor(private readonly db: ShortsDatabase, private readonly monthlyBudgetUsd: number) {
    this.db.db.exec('CREATE TABLE IF NOT EXISTS usage_ledger (id TEXT PRIMARY KEY, month TEXT NOT NULL, provider TEXT NOT NULL, operation TEXT NOT NULL, estimated_cost_usd REAL NOT NULL, created_at TEXT NOT NULL)')
  }

  monthKey(date = new Date()) { return date.toISOString().slice(0, 7) }
  monthTotal(month = this.monthKey()) { return Number((this.db.db.prepare('SELECT COALESCE(SUM(estimated_cost_usd),0) as total FROM usage_ledger WHERE month = ?').get(month) as { total: number }).total) }
  assertCanSpend(amount: number) { if (this.monthTotal() + amount > this.monthlyBudgetUsd) throw new DomainError('BUDGET_EXCEEDED', `Monthly AI budget of $${this.monthlyBudgetUsd.toFixed(2)} would be exceeded`, 429) }
  record(provider: string, operation: string, estimatedCostUsd: number) { if (estimatedCostUsd <= 0) return; this.assertCanSpend(estimatedCostUsd); this.db.db.prepare('INSERT INTO usage_ledger (id,month,provider,operation,estimated_cost_usd,created_at) VALUES (lower(hex(randomblob(16))),?,?,?,?,?)').run(this.monthKey(), provider, operation, estimatedCostUsd, new Date().toISOString()) }
  summary() { return { month: this.monthKey(), spentUsd: this.monthTotal(), budgetUsd: this.monthlyBudgetUsd, remainingUsd: Math.max(0, this.monthlyBudgetUsd - this.monthTotal()) } }
}
