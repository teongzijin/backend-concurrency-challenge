# DECISIONS

Short version: money correctness comes first. Every balance change goes through one function, under a row lock, inside one DB transaction, and is backed by constraints in the database so that a bug in the service layer still cannot create or lose money.

Time spent: around 4 hours. 

## What I built

- `POST /deposits`: creates a `pending` funding transaction with a generated `pspRef`. No money moves.
- `POST /psp/callbacks`: idempotent, concurrency safe, credits the wallet at most once.
- `POST /wallets/:walletId/wagers`: debits and accrues turnover.
- `POST /withdrawals`: turnover lock, then debit, then a `pending` funding transaction.
- 3 migrations, 2 new models, and a single ledger helper (`walletLedger.ts`) that is the only place balances change.

## Money model

- `DECIMAL(36,18)` in Postgres, strings in JS and JSON, `bignumber.js` for all math (starter convention, kept). `toDb()` formats values for storage. Input is validated with a strict regex before it reaches BigNumber, so `1e3`, `-5` or `abc` are 400s.
- `wallet_txs` is the ledger. Amounts are signed (credit positive, debit negative) and each row stores `balance_after`. The invariant `SUM(amount) == wallets.balance` is asserted in the tests after every money flow (`expectLedgerMatchesBalance`).
- `wallets.balance` is a cached projection of the ledger. I chose to keep it (rather than compute from the ledger on every read) because wagers are the hot path and need a single row to lock and check.

## Defence in depth

Any single layer below can fail and money is still safe:

1. Row lock (`SELECT ... FOR UPDATE`) serialises work on a funding transaction or wallet.
2. Explicit state machine (`fundingStateMachine.ts`): only `pending -> completed | failed`. Terminal states cannot move. Invalid transitions return 409, they are never applied silently.
3. `UNIQUE (funding_tx_id, type)` on `wallet_txs`. Even if the lock and state check were both bypassed, the same funding transaction cannot be credited twice.
4. `CHECK (balance >= 0)` on `wallets`. Overdraw is impossible at the database level.
5. A trigger on `wallet_txs` rejects UPDATE and DELETE, so the ledger is append-only for real, not by convention.
6. CHECK constraints on type, status, positive amount and non-negative multiplier.

## Locking strategy

I used pessimistic row locks (`FOR UPDATE`) inside a transaction.

- Callback: lock the funding transaction (found by `psp_ref`), decide, then lock the wallet and write the ledger entry. Wager and withdrawal lock only the wallet.
- Lock order is always funding transaction first, then wallet. A withdrawal creates its own new funding row, which nobody else can reference, so there is no cycle and no deadlock path.
- Concurrent duplicate callbacks queue on the funding row. The loser wakes up after the winner commits, sees a terminal state, and returns `duplicate`. The test fires 10 at once and asserts exactly one `credited`, nine `duplicate`, one ledger row.

Alternative considered: conditional updates (compare and set), for example `UPDATE funding_transactions SET status='completed' WHERE id=? AND status='pending'` and `UPDATE wallets SET balance = balance - ? WHERE id=? AND balance >= ?`. This is also correct and has fewer round trips and a shorter lock window. I chose `FOR UPDATE` because withdrawal has to check status, balance and turnover together and return a specific 422 body (how much turnover is outstanding). Reading the locked row and then deciding keeps that logic linear and easy to review. If wager throughput became the bottleneck, wager is the first path I would convert to a single conditional UPDATE.

Implementation note: every query inside a transaction must pass `{ transaction: t }`. A query that forgets it takes a second connection from the pool (Sequelize default max is 5) and can wait on a lock held by its own transaction. The concurrency tests would hang or time out if that slipped in.

## Callback decisions

| Case | Behaviour | Why |
|---|---|---|
| Duplicate, same terminal result | 200, `duplicate`, no effect | PSPs retry. Acknowledge so they stop. |
| Concurrent duplicates | Serialised by the row lock, one `credited` | See above |
| Amount differs from the deposit | Not credited. Marked `failed` with `failure_reason = amount_mismatch`, the reported amount stored in `psp_reported_amount`, error logged. 200 returned | Crediting the PSP's number or ours are both guesses. Underpay and overpay both need a human. The money is not lost, it is flagged. |
| Unknown `pspRef` | 200, logged, nothing written | A non-2xx makes the PSP retry forever. It should alert in production. |
| `failed` after `completed` (or the reverse) | 409 `conflicting_callback` | A terminal state never changes. This is the case that needs human attention. |
| Malformed payload | 400 | Validated with zod at the boundary |

The outcome is derived from the callback alone (`completed` plus matching amount means `completed`, everything else means `failed`), so replaying the same callback always maps to the same target state. That is what makes duplicates detectable.

## Turnover rule

- `wallets.turnover_required` increases by `amount * turnover_multiplier` when a deposit completes. `turnover_accrued` increases by the wager amount. Both change under the same wallet lock as the balance, in the same transaction.
- A withdrawal is allowed only when `accrued >= required`. Otherwise 422 `turnover_not_met` with `outstanding`, `required` and `accrued`.
- Assumption: these are lifetime totals and a withdrawal does not reset them. The brief does not say. It also means wagers placed before a deposit count toward that deposit's requirement. A per-deposit turnover bucket would be stricter, and I would ask the product owner which one the real rule is.
- A blocked withdrawal writes nothing (tested).

## Schema choices

- One `funding_transactions` table for deposits and withdrawals (as the brief describes), discriminated by `type`. `psp_ref` is nullable and unique, so withdrawals do not need one.
- Turnover counters live on `wallets` instead of being computed from history. Cheap to check inside the lock, at the cost of denormalisation. The ledger remains the source of truth for balance.
- Wager and deposit and withdrawal are all `wallet_txs` rows, so one invariant covers everything.
- Migrations only, no `sync()` (starter convention).

## Known gaps and what I would do next

Roughly in priority order:

1. **Idempotency keys on client requests.** A client retry of `POST /wagers`, `/deposits` or `/withdrawals` creates a second record. PSP callbacks are idempotent, but our own API is not yet.
2. **Manual review state and a refund path.** `amount_mismatch` should go to a `needs_review` state, not `failed`. A rejected withdrawal needs a compensating ledger entry that returns the money. The state machine supports `pending -> failed` for withdrawals but there is no endpoint and no refund entry yet.
3. **Store every raw callback** (provider, event id, headers, body, received_at) in an append-only table. Today a replayed callback with a different amount leaves no trace beyond the first one.
4. **Reversals and chargebacks.** A PSP reversing a completed deposit currently gets a 409. It needs a modelled `reversed` flow.
5. **Reconciliation job.** Compare PSP settlement reports with `completed` deposits, and assert `SUM(ledger) == balance` for every wallet on a schedule.
6. **Pending deposit expiry**, lock timeouts (`lock_timeout`), and a retry on serialization or deadlock errors.
7. **Per-deposit turnover buckets** if the business rule needs them (see above).
8. Auth and ownership checks (a wallet id in the path is currently trusted). Out of scope per the brief.

## Tests

19 tests, Jest and supertest against a real Postgres (SQLite cannot test row locks).

- Duplicate callback, sequential and concurrent (10 parallel).
- Amount mismatch, unknown ref, conflicting callback.
- Concurrent wagers: 20 parallel wagers of 10.00 against 100.00, exactly 10 succeed, final balance 0.
- Concurrent withdrawals cannot overdraw.
- Turnover lock blocks, reports the exact outstanding amount, and unblocks.
- Ledger sum equals balance after each flow.

## AI usage

I used Claude (Anthropic) as a pair-programming assistant to explore locking trade-offs, draft the migrations, services, tests, and documentation. I then used ChatGPT to cross-check the architectural decisions and concurrency edge cases. I ran the full test suite locally against PostgreSQL and personally reviewed and verified the implementation and design decisions.
