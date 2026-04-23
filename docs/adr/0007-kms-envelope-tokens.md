# ADR 0007: KMS envelope encryption for OAuth tokens

**Status:** Accepted
**Date:** 2026-04-22
**Corresponds to:** D-07

## Context

OAuth access/refresh tokens are the keys to every connected creator's platform account. They must be encrypted at rest with auditable key management. Two workloads distinguish: platform app credentials (few, long-lived) vs per-account OAuth tokens (many, high-churn).

## Decision

**Two stores for two workloads:**

1. **Platform app credentials** → AWS Secrets Manager. Loaded on boot and on rotation. Rotatable without redeploy.
2. **Per-account OAuth tokens** → envelope-encrypted in MySQL. A random data key encrypts the token (AES-GCM); the data key itself is encrypted by an AWS KMS CMK and stored alongside the ciphertext. One KMS CMK alias per environment: `alias/connector-{env}-token`. Decryption is in-memory only at point of use; tokens never logged.

## Alternatives considered

- **All tokens in Secrets Manager** — rejected; not economical at scale (tens of thousands of secrets). Hot-path decrypt via Secrets Manager has higher latency than local envelope decrypt with a cached CMK.
- **Tokens in MySQL, AES-GCM with a static key in env vars** — rejected; no CMK rotation story, no audit trail of decrypt events, secret lives in process memory.
- **KMS direct encrypt (no envelope)** — rejected; KMS has payload size limits and higher per-request cost; envelope is the standard pattern for this workload.

## Consequences

**Positive:**
- Every token decrypt is auditable via CloudTrail (KMS Decrypt calls).
- Standard pattern (Plaid-like workloads use exactly this).
- CMK rotation handles the long-tail key hygiene; data keys are ephemeral.
- Cheap: one KMS Decrypt per token use, not one per secret.

**Negative:**
- Adds a KMS dependency on every token use. Outage = no token decrypt = no API calls.
- Rekey operation (when CMK rotates) needs a maintenance procedure (nightly cron iterates tokens).

**Mitigations:**
- KMS is highly available (multi-AZ by default in AWS regions).
- Rekey cron rate-limited to protect RDS write capacity.
- Re-encryption uses old CMK ciphertext for decrypt → new CMK for re-encrypt; zero downtime.

## Related

- [`../04-data-model.md`](../04-data-model.md) §`oauth_tokens`
- [`../08-operations/security.md`](../08-operations/security.md) §KMS envelope encryption
