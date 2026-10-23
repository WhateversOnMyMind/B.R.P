# BlindBalance control Worker

This directory is backend source and must stay outside Netlify's public build. It implements the `/v1` contract used by the hosted control page and ESP32 firmware. No remote resources, deployment, production credentials, or device flashing are created by tests or by a packaging check.

## Local verification

Use Node 22.14 or newer (the tests use real `node:sqlite`) and npm:

```powershell
npm ci --ignore-scripts
npm test
npm run check
```

Wrangler is pinned in `package.json` and `package-lock.json`. `check` runs `wrangler deploy --dry-run`, generating an ignored `build/` bundle without publishing it. In a restricted workspace, point Wrangler's configuration and logs to its ignored local directory:

```powershell
$env:XDG_CONFIG_HOME = Join-Path $PWD '.wrangler\config'
$env:WRANGLER_SEND_METRICS = 'false'
npm run check
```

The integration harness in `test/harness.mjs` exports `createHarness`, `SQLiteD1`, `MemoryR2`, and `hash`. `createHarness()` provides `request`, `exchange`, `online`, `command`, `state`, `DB`, `CAPTURES`, and `env`. Authentication, routing, SQL predicates, SQL transactions, serialization, and hashing run in the production Worker. Only external R2 storage is replaced with an in-memory object store. The root `tests/hosted-integration.test.mjs` exercises the frontend model against this same Worker.

Local Wrangler development is optional:

```powershell
npx wrangler d1 migrations apply blindbalance-control --local
npm run dev
```

Provision a disposable pair as described below and execute its generated `insert.sql` with `--local` to exercise authenticated local requests. Do not put local URLs or disposable credentials in the public site or production firmware.

## Provisioning and account setup

The checked-in `wrangler.jsonc` is a local/template configuration. Its account ID was verified read-only in the user's Cloudflare dashboard. Its Worker/database/bucket names are proposed names; **no remote database ID has been invented**. At implementation time Workers Free and an existing R2 subscription were visible, but the control Worker, D1 database, and capture bucket had not been created.

Before remote creation, verify quotas and expected usage in that account. At a two-second cadence, two continuously connected devices produce 86,400 exchanges/day before browser polling, preflights, uploads, and retries. Every accepted heartbeat writes status and runs several bounded SQL statements, so examine D1 rows read/written as well as Worker requests. Run a measured limited bench session, inspect actual metrics, and tune cadence or choose an explicitly approved plan before all-day operation. This code does not enroll or upgrade any service.

After account setup/resource creation and deployment are authorized, run these commands from this directory. They are documentation, not actions performed by the implementation:

```powershell
npx wrangler login
npx wrangler d1 create blindbalance-control
npx wrangler r2 bucket create blindbalance-captures
Copy-Item wrangler.jsonc wrangler.production.jsonc
```

Put the real returned D1 `database_id` into the `DB` entry in `wrangler.production.jsonc`. Confirm the real bucket name and account. The production copy is gitignored; keep its nonsecret configuration in the deployment handoff separately. Add only exact trusted site/Netlify preview origins to the comma-separated `ALLOWED_ORIGINS` value. No wildcards or credential-bearing URLs are supported. Keep the R2 bucket private: do not enable `r2.dev` or a public custom domain.

Apply the schema, then generate a new pair's credentials locally:

```powershell
npx wrangler d1 migrations apply blindbalance-control --remote --config wrangler.production.jsonc
node tools/provision.mjs pair PAIR_ID LEFT_DEVICE_ID RIGHT_DEVICE_ID OPERATOR_LABEL
```

Use unique IDs/labels containing letters, digits, underscore or hyphen (maximum 100 characters). The tool writes a new private `provisioning/<pair>-<uuid>/` directory with:

- `secrets.json`: three independent 256-bit opaque keys, one for the operator and one per device.
- `insert.sql`: verifier hashes and nonsecret identity records only.

The tool prints only the directory location. It never prints a key, makes a remote call, or overwrites an earlier output. Review the generated identities, then import the SQL using the actual generated path:

```powershell
npx wrangler d1 execute blindbalance-control --remote --config wrangler.production.jsonc --file provisioning/ACTUAL_FOLDER/insert.sql
```

Treat the entire provisioning folder as sensitive and keep it out of Git, static hosting, logs, screenshots, and chat. Unix creation modes are restrictive; on Windows, use a private user directory with appropriate NTFS permissions. Distribute the operator key securely; the browser retains it only in memory. Put each device's own key in that board's ignored `CloudConfig.h`. Never reuse an operator key on a device.

For an additional operator or key rotation, these commands generate new local files without changing existing records:

```powershell
node tools/provision.mjs operator EXISTING_PAIR NEW_OPERATOR_LABEL
node tools/provision.mjs device EXISTING_PAIR EXISTING_DEVICE_ID NEW_DEVICE_LABEL
```

Import the reviewed SQL, update the affected client, then revoke the old credential by its verifier hash (available in the old `insert.sql`) or by a unique label and pair. For example, with reviewed nonsecret identifiers:

```sql
UPDATE credentials SET revoked=1 WHERE pair_id='PAIR_ID' AND label='OLD_UNIQUE_LABEL';
```

For immediate loss response, revoke first. The Worker checks revocation on every request. Credential generation does not itself revoke older keys. Device IDs must belong to the declared pair; mismatched records cannot authenticate.

Only after the configuration, schema, identities, and site origins are reviewed:

```powershell
npm run deploy
```

`deploy` deliberately requires the separate production configuration file. Use the actual HTTPS URL reported by Wrangler for the frontend public API base and the firmware API base. Verify it with authenticated synthetic devices before physical firmware cutover. Do not infer successful deployment from `check` or local tests.

For deployed verification, provision a separate pair whose ID starts with `deployment-smoke-`, import its generated SQL, and run:

```powershell
node tools/smoke.mjs https://YOUR-WORKER.workers.dev provisioning/ACTUAL_TEST_FOLDER/secrets.json
```

This creates simulated device status, commands, and a tiny CSV only in that dedicated test pair. It checks authentication, role scope, exact CORS behavior, paired settings (including float32 sensitivity 0.3), private upload/download checksums, and reboot invalidation. It writes a nonsecret `smoke-report.json` beside the credentials. Never use a physical pair's credentials. After browser QA, revoke the test pair's credentials; retain or remove its synthetic records according to the deployment cleanup policy.

## Contract and lifecycle details

All routes require a Bearer key except CORS preflights. Authorization comes from the token's stored pair and device association; body fields never select identity. Device keys cannot read operator endpoints and operator keys cannot impersonate devices. Responses use `Cache-Control: no-store`. Only explicitly configured origins receive CORS headers; requests without Origin (firmware/CLI) still require authentication.

- Device exchange: `POST /v1/device/exchange`. Boot IDs are canonical decimal uint32 strings; sequence is a strictly increasing positive safe integer per boot. The backend records prior boots so delayed requests from a retired boot cannot restore it. Duplicate/stale sequences return 409 without refreshing that device. Keep one exchange in flight per board.
- Operator state: `GET /v1/operator/state`, including the latest 50 commands and latest 50 capture metadata records. Optional diagnostic status fields survive serialization. `results.L`/`results.R` are `{result:"applied"|"failed",message}` objects. Missing entries mean unconfirmed.
- Commands: `POST /v1/operator/commands` returns **201** and `{id,revision}`. Invalid input is 400, stale revision/busy/capture conflict is 409, and an offline required board is 503. Atomic D1 batch predicates compare the revision, check freshness/capture state, insert a command, and increment the revision together. A partial unique index also enforces one pending command per pair.
- Shared settings are delivered only to left. Left execution acknowledgment is insufficient for pair success. Right must publish the same revision and corresponding setting on its captured boot. A reboot makes affected pending commands `unknown`; expired commands become `expired`. Existing results remain visible, including partial application. HTTP submission acceptance never means applied.
- Device ACKs must match command ID, revision, scope, and boot. Identical results are idempotent, while conflicting, unknown, wrong-scope, wrong-boot, or expired unrecorded results return 409. A device must discard a definitively rejected ACK and publish a subsequent status; retry transient network/5xx failures without applying a command twice. TTL is computed at response time; firmware subtracts elapsed request time before local execution.
- Raw start requires an empty current capture and assigns the command UUID as `captureId`. Stop/clear require the exact capture ID; clear additionally requires stopped capture state. Firmware independently enforces these same guards.
- Upload: `PUT /v1/device/captures/<captureId>` with exact Content-Length and lowercase SHA-256. Only an issued raw-start ID for that device is accepted. A new upload must match stopped device status and byte count. The Worker bounds reads at 2,000,160 bytes, verifies length/hash, and writes a content-addressed private R2 object before publishing D1 metadata. Finalization rechecks the capture identity/state. Conflicting uploads cannot overwrite committed content. Reuploading the same bytes/hash is idempotent, including after the local capture has subsequently been cleared.
- Download: `GET /v1/operator/captures/<deviceId>/<captureId>`. It authorizes the pair before reading R2 and returns CSV with Content-Disposition, length, and checksum. No public object URL is exposed.

R2 and D1 do not share a transaction. An upload that loses a finalization race can leave an unreferenced private object; it cannot become downloadable. Reconcile unreferenced objects against `captures.object_key` during planned storage maintenance. Do not use a blanket bucket lifecycle deletion policy that could remove referenced captures. No automatic record/capture retention deletion is included: choose an explicit research retention policy and monitor storage. Retired boot records must remain while their device credential is valid to prevent old-boot replay.

## Required rollout evidence

Local checks establish protocol and SQL behavior, not actual account limits, production D1/R2 behavior, radio timing, or physical motor output. Before cutover verify authentication/revocation with the deployed API, real D1 and private R2 upload/download checksums, allowed preview/production CORS origins, both arm acknowledgments, expiry/reboot/outage behavior, TLS certificate validation, and the firmware's five-minute measurement/peer/Sheets timing bench. Preserve paired firmware and the previous site deployment for rollback. No remote provisioning or physical flashing is part of the local implementation.

Cloudflare references: [D1 batch transactions](https://developers.cloudflare.com/d1/worker-api/d1-database/), [R2 Worker API and checksums](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/), [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/), and [Workers limits](https://developers.cloudflare.com/workers/platform/limits/).
