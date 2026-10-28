# Certificate Vault

The vault stores each tenant's A1 certificate (`.pfx`) and its password, encrypted. Only the server decrypts them, in memory, to sign or to open the mTLS connection.

## Envelope encryption

- Each certificate has its own random 32-byte data key.
- The data key encrypts the `.pfx` and the password with AES-256-GCM. Each sealed value is `iv (12 bytes) | tag (16 bytes) | ciphertext`.
- `NFSE_MASTER_KEY` (32 bytes, base64) encrypts the data key the same way. The database stores only the wrapped data key.
- Each part carries the AAD `notaflow:certificate:<emitterId>:<part>` (`pfx`, `password`, or `key`). A writer who has database access but not the master key cannot move a certificate into another emitter's row, or swap two parts of one row: GCM then refuses to open it.
- `certificates.seal_version` is `1` for these rows. Rows sealed before the AAD have `0`. At startup, `resealCertificates` opens each active `0` row, checks that the CNPJ in the `.pfx` is the emitter's, and seals it again as `1`. A row that fails the check stays at `0` and is logged as `certificates not resealed`. The store never loads a `0` row.
- A wrong key and a tampered value both raise `VaultError`. The vault never returns partial bytes.

Code: `apps/server/src/vault/envelope.ts` and `VaultCertificateStore.ts`.

## Key rotation

A master key rotation re-wraps each data key with `rewrapKey(wrappedKey, oldKey, newKey, emitterId)`. The `.pfx` and password ciphertexts do not change.

## Losing the master key

Stored certificates become unreadable. The owners upload their `.pfx` again. Invoices are not lost, because the ADN keeps them.

## Rules

- A certificate, its password, and the master key never go to disk in clear text and never go to a log.
- Onboarding runs the connection test before it stores anything, so a failed test leaves no emitter and no certificate.
- An emitter has one active certificate. A replacement keeps the old row, inactive, as history.
- The UI warns 30 days before the active certificate expires (`expiresSoon` in `GET /api/accounts/:accountId/emitters`).
