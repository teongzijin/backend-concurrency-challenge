# DESIGN-PSP: the 50th PSP

Goal: adding a PSP is a one-day, low-risk task for a junior. The rule that makes this possible: **a PSP adapter can only translate. It can never touch money.** All money movement stays in one provider-agnostic core that already handles idempotency, concurrency and the state machine.

## Sketch

```
POST /psp/:provider/callbacks
        |
        v
  [ raw body capture ]        express.raw() on this route, signatures need exact bytes
        |
        v
  registry.get(provider) ---> PspAdapter            (one folder per PSP)
        |                      1. verify(raw, headers, cfg)   -> throws if invalid
        |                      2. parse(raw, cfg)             -> NormalizedPspEvent
        v
  psp_events (append-only)    store raw payload + event id, dedupe on (provider, event_id)
        |
        v
  handlePspEvent(event)       EXISTING core: row lock, state machine, ledger, mismatch rules
```

The core never sees a provider payload, only `NormalizedPspEvent`.

## Interface

```ts
type PspStatus = 'pending' | 'completed' | 'failed';

interface NormalizedPspEvent {
  provider: string;
  eventId: string;        // provider's id, or a hash of the body if none
  pspRef: string;         // our reference echoed back
  status: PspStatus;      // already mapped to OUR vocabulary
  amount: string;         // decimal string in major units, already converted
  currency: string;
  occurredAt?: Date;
}

interface PspAdapter {
  readonly id: string;
  verify(raw: Buffer, headers: Headers, cfg: ProviderConfig): void;  // throw on bad signature
  parse(raw: Buffer, cfg: ProviderConfig): NormalizedPspEvent;       // pure function
}
```

Both methods are pure (no DB, no network), which is what makes them cheap to test.

## Where things live

- **Verification** lives in the adapter (`verify`). HMAC, RSA, IP allowlist or a shared token all fit behind the same signature. The route rejects with 401 before anything is parsed or stored. Shared helpers (`hmacSha256`, `timingSafeEqual`) live in `psp/lib` so nobody hand-rolls crypto.
- **Normalization** lives in the adapter (`parse`), in three explicit steps:
  1. Status mapping table (`{ SUCCESS: 'completed', PAID: 'completed', PROCESSING: 'pending', ... }`). Unknown vocabulary throws, it never defaults to success.
  2. Amount conversion through one helper, `toMajorUnits(value, exponent)`, using BigNumber. Minor-unit PSPs set `amountExponent` in config. Money never touches a JS number.
  3. Field mapping to `NormalizedPspEvent`.
- **Business rules** (credit once, mismatch handling, state machine) stay in the core and are shared by all 50 PSPs.

## Quirks, and where each is absorbed

| Quirk | Handled by |
|---|---|
| Aggressive retries, duplicates | Core idempotency (row lock, state machine, unique ledger index), plus `psp_events` dedupe |
| `completed` arrives before `pending` | Core treats `pending` as a no-op once a state is terminal. Out-of-order events never move a state backwards. |
| Minor units | `amountExponent` in config plus `toMajorUnits` |
| Different status words | Mapping table in the adapter |
| Different signature scheme | `verify` in the adapter |
| `pspRef` uniqueness across PSPs | Unique on `(provider, psp_ref)`, not `psp_ref` alone |

## Config drives it

One typed entry per provider, secrets from the environment, validated by zod at boot (a missing secret fails startup, not the first callback):

```ts
providers: {
  acmepay: { adapter: 'acmepay', secretEnv: 'ACMEPAY_SECRET', amountExponent: 2, enabled: true },
}
```

Registry: `Record<string, PspAdapter>`. Adding a provider is one folder, one registry line, one config entry. No core file changes, which is what makes it safe to hand to a junior.

## The junior's checklist (one day)

1. Copy `psp/_template/` to `psp/acmepay/`.
2. Fill in `verify` and `parse`, and the status table.
3. Add the config entry and the registry line.
4. Drop 4 to 6 real sample payloads into `psp/acmepay/fixtures/` with their expected normalized output.
5. Run `npm test`. The shared contract suite runs automatically against every registered adapter and tells them what is wrong.

## Testing a provider we cannot call in CI

- **Recorded fixtures.** Real payloads from the provider's docs or sandbox, saved as files with their headers and the expected `NormalizedPspEvent`. The adapter tests are golden-file tests: pure, fast, no network.
- **Shared contract suite**, table-driven over every adapter, so a new PSP gets the safety net for free:
  - valid signature is accepted, tampered body or wrong secret is rejected
  - every status in the mapping normalizes correctly, an unknown status throws
  - amounts normalize exactly (minor units, trailing zeros, large values)
  - end to end through the real core: duplicate delivery credits once, concurrent delivery credits once, out-of-order `pending` after `completed` is ignored
- **Signed-payload generator** in test helpers, so tests can produce valid signatures with a test secret instead of relying on a frozen real one.
- **Local fake PSP** (a small script that can retry, delay, duplicate and reorder callbacks) for integration tests of the core.
- **Outside CI:** a scheduled smoke test against the provider's sandbox that alerts on drift, so a PSP silently changing its format shows up as one failing job and not a production incident.

## Operations

Every callback is stored raw before processing (`psp_events`), so a bad parse can be fixed and replayed. Metrics per provider (received, rejected signature, unknown ref, mismatch) make a misbehaving PSP visible quickly.
