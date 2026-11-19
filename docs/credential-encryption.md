# Credential encryption

Keeper.sh stores the credentials it needs to reach your calendar providers in its database. This page describes how those values are encrypted, what happens when you upgrade, how to replace the key, and what to do if a key is gone.

It is written for whoever operates an instance. There is nothing to run by hand: if `ENCRYPTION_KEY` is set, credentials are encrypted for you.

## What is encrypted

| Table and column | Without `ENCRYPTION_KEY` | With `ENCRYPTION_KEY` |
| --- | --- | --- |
| `oauth_credentials.accessToken`, `.refreshToken` | plaintext | encrypted |
| `caldav_credentials.encryptedPassword` | CalDAV unavailable | encrypted |

Not covered: ICS source URLs (`calendars.url`), which can carry a secret in the path or in `user:pass@`, are stored as given.

An installation without `ENCRYPTION_KEY` keeps working as it always has, with OAuth tokens stored as plaintext and CalDAV accounts unavailable.

**Keep a copy of `ENCRYPTION_KEY` somewhere other than the server that uses it.** Once credentials are encrypted, a lost key means every connected Google and Microsoft account has to be reconnected and every CalDAV password entered again. Before this, only CalDAV passwords depended on the key.

## Format

A stored value looks like this:

```
enc:v1:<key id>:<nonce>:<ciphertext and tag>
```

- AES-256-GCM, a random 96-bit nonce per value, a 128-bit authentication tag.
- The key id is 16 hexadecimal characters derived from the key. It identifies which key wrote the value and reveals nothing about the key.
- Each value is bound to its table, column and row. Copied onto another row or column, it does not decrypt.
- `ENCRYPTION_KEY` itself is never used directly by this format; the cipher key and the key id are derived from it with HKDF-SHA256.

CalDAV passwords written by older releases use NaCl secretbox and look like `<nonce>:<ciphertext>`. They are converted to the format above automatically.

Key ids and the `enc:v1:` prefix are not secret. Everything in this document that asks you to look at the database looks only at those.

## Settings

Both apply to `api`, `cron` and `worker`, and must be identical across them.

| Setting | Purpose |
| --- | --- |
| `ENCRYPTION_KEY` | The key values are written with. 32 random bytes, base64: `openssl rand -base64 32`. |
| `ENCRYPTION_KEYS_DECRYPT_ONLY` | Comma-separated extra keys that may read but never write. Used only while replacing the key. |

A database backup can only be read with the keys that were current when it was taken, so keep every key that has ever written data for as long as you keep those backups.

## What happens when you upgrade

Database migrations already run when Keeper.sh starts: in the single-container images, and in the `api` image unless `RUN_MIGRATIONS=false`. The same run now finishes by bringing every stored credential under the current `ENCRYPTION_KEY`:

- OAuth tokens that are still plaintext are encrypted.
- CalDAV passwords in the original format are rewritten in the versioned format.
- Values under a key listed in `ENCRYPTION_KEYS_DECRYPT_ONLY` are rewritten under `ENCRYPTION_KEY`.

It runs on every start and does nothing once everything is under the current key. From then on new and refreshed credentials are written encrypted as well.

If you run migrations as a separate step with `RUN_MIGRATIONS=false`, give that step the same `ENCRYPTION_KEY` and `ENCRYPTION_KEYS_DECRYPT_ONLY` as the services. Without them it reports `skipped` and stored credentials stay as they are until a run that has the key.

The run prints one line of JSON made of counts and key ids. It never contains a stored value, a key or the connection settings:

```json
{"credential_encryption.decrypt_only_key_ids":[],"credential_encryption.passes":1,"credential_encryption.primary_key_id":"8ab98ab02f10a441","credential_encryption.rows_contended":0,"credential_encryption.rows_failed":{},"credential_encryption.rows_scanned":412,"credential_encryption.skip_reason":null,"credential_encryption.status":"complete","credential_encryption.stopped":null,"credential_encryption.values_converted":824,"credential_encryption.values_unreadable":{},"level":30,"msg":"stored credentials are encrypted under the current key","time":"2031-01-01T00:00:00.000Z"}
```

`rows_scanned` counts the rows that were not yet entirely under the current key, so it is `0` on a start that had nothing to do.

| `credential_encryption.status` | Meaning |
| --- | --- |
| `complete` | Every stored credential is under the current key. |
| `incomplete` | Some values were left as they were. The counts say why; the next start tries them again. |
| `skipped` | Nothing was changed. `credential_encryption.skip_reason` says whether no key is set or the key cannot be used. |

Things that leave a value as it was, none of which stop the migration or the start:

- **A row in use.** A token being refreshed at that moment is not waited for and is never overwritten (`rows_contended`).
- **A value that cannot be read**, because the key that wrote it is not configured or the value is damaged (`values_unreadable`, by reason).
- **A row the database would not write** (`rows_failed`, by reason).
- **The credential tables being unavailable, or the run taking longer than five minutes.** It stops where it is and `stopped` says why. As a guide, ten thousand rows take ten to thirty seconds.
- **An `ENCRYPTION_KEY` that is not 32 bytes of base64.** Nothing is encrypted and OAuth accounts keep working as before; the line carries a warning and the reason. Replace it with a real key to turn encryption on.

A malformed `ENCRYPTION_KEYS_DECRYPT_ONLY`, or one set without `ENCRYPTION_KEY`, does stop the start, before the database is contacted. The message names the setting and the position in the list, never the key.

One side effect to expect on the first run: a calendar that is waiting because its credential was rejected is given one more attempt when that credential's stored value is rewritten. Those attempts fail and the calendar waits again.

### Upgrading from an older release

An older release treats an encrypted value as if it were the token itself, so nothing older than the release that introduced this format may still be running once credentials are encrypted.

- **Single-container images:** everything restarts together. Upgrade as usual.
- **Separate `api`, `cron` and `worker` containers:** upgrade and restart all three together. If you are coming from a release older than the one that reads this format, stop `cron` and `worker` before the new `api` starts, since `api` is the one that runs the migration. If you restart services one at a time, or keep old instances serving during a rollout, first move every service to the release that reads this format, and only then to this one.
- **Do not downgrade** below the release that reads this format afterwards. If you must, restore a database backup taken before the upgrade.

If an older `cron` or `worker` does meet an encrypted value, its syncs for that account fail, and if it tries to refresh the token the provider refuses it and the account is marked as needing to be reconnected. Upgrading that service is the fix. The mark is cleared the next time one of that account's calendars is read successfully; an account that is only written to stays marked until its owner reconnects it.

### Checking

The same counts without the log line, reading only prefixes:

```sql
SELECT
  count(*) FILTER (WHERE "accessToken" LIKE 'enc:v1:%')      AS access_encrypted,
  count(*) FILTER (WHERE "accessToken" NOT LIKE 'enc:v1:%')  AS access_plaintext,
  count(*) FILTER (WHERE "refreshToken" LIKE 'enc:v1:%')     AS refresh_encrypted,
  count(*) FILTER (WHERE "refreshToken" NOT LIKE 'enc:v1:%') AS refresh_plaintext
FROM oauth_credentials;

SELECT split_part("refreshToken", ':', 3) AS key_id, count(*)
FROM oauth_credentials
WHERE "refreshToken" LIKE 'enc:v1:%'
GROUP BY 1;

SELECT
  count(*) FILTER (WHERE "encryptedPassword" LIKE 'enc:v1:%')     AS versioned,
  count(*) FILTER (WHERE "encryptedPassword" NOT LIKE 'enc:v1:%') AS original_format
FROM caldav_credentials;
```

## Replacing the key

Replacing a key is a matter of changing settings and restarting.

**Single-container images:**

1. Generate the new key and store a copy.
2. Set `ENCRYPTION_KEY` to the new key and put the old key in `ENCRYPTION_KEYS_DECRYPT_ONLY`. Restart. The start rewrites every value under the new key.
3. Confirm the line reports `complete`, or that the queries above show only the new key id. Then remove the old key from `ENCRYPTION_KEYS_DECRYPT_ONLY` and restart.

**Separate containers, or more than one instance of a service:** at every moment each running instance must be able to read what any other instance writes, so introduce the new key as read-only first.

1. Generate the new key, store a copy, and add it to `ENCRYPTION_KEYS_DECRYPT_ONLY` on all services. Restart them all. Nothing is written with it yet.
2. Set `ENCRYPTION_KEY` to the new key and move the old key into `ENCRYPTION_KEYS_DECRYPT_ONLY`. Restart all services.
3. Check the queries above. An instance that was still running with the old settings during step 2 may have written a few values under the old key; if any remain, restart `api` once more and check again.
4. When only the new key id is listed, remove the old key from `ENCRYPTION_KEYS_DECRYPT_ONLY` and restart.

Do not remove the old key while any value is still under it: those values become unreadable.

Keep the old key in safe storage for as long as you keep database backups taken before the last step.

As a guideline for scale, a single key should not write more than about four billion values. At one refresh per account per hour that is several hundred thousand account-years, so in practice the reason to replace a key is that it may have been seen by someone who should not have it, not volume.

## If a key is lost

A value can only be read with the key that wrote it. There is no recovery path that does not involve that key.

What you will see: syncs for the affected accounts fail with `SecretDecryptionError`, and the line printed at start reports `values_unreadable` with the reason `missing-key` (no configured key has that id) or `unreadable` (a key with that id is configured but the value does not authenticate, or an original-format password matches none of the configured keys). Keeper.sh does not flag accounts or change any data when this happens, so restoring the key restores service with nothing else to repair.

In order:

1. **Look for the key before changing anything.** Previous deployment configuration, your secret store's version history or its recovery window for deleted secrets, a password manager, an older `.env`. The second query above tells you the id of the key you are looking for; to check a candidate, add it to `ENCRYPTION_KEYS_DECRYPT_ONLY` and restart: if the line no longer reports that id as `missing-key`, it is the right one.
2. **If it is found,** put it back (as `ENCRYPTION_KEY`, or in `ENCRYPTION_KEYS_DECRYPT_ONLY` if you have since moved to another key) and restart.
3. **If it is gone,** the affected credentials have to be issued again by their owners:
   - Set a new `ENCRYPTION_KEY`.
   - Ask affected users to reconnect. Marking their accounts makes the app prompt them:

     ```sql
     UPDATE calendar_accounts
     SET "needsReauthentication" = true
     WHERE "oauthCredentialId" IN (
       SELECT id FROM oauth_credentials
       WHERE split_part("refreshToken", ':', 3) = '<lost key id>'
     );
     ```

   - Reconnecting a Google or Microsoft account overwrites its stored tokens. CalDAV accounts are reconnected by entering the password again.

   Values written while no key was configured are unaffected.

## Notes

- Row binding protects against a stored value being copied to a different row or column. It does not make the database tamper-proof: someone who can write to the database can still repoint an account at a different credential row.
- The auth library keeps its own copies of the tokens issued at sign-in in the `account` table. Those are separate from the calendar credentials described here.
