# Progress — 2026-10-23 Cloudflare hosted control

Plan: `2026-10-23-cloudflare-control.md`. Original design: `../specs/2026-10-23-hosted-blindbalance-control-design.md`.

## Confirmed decisions

- User approved implementation, confirmed internet availability, requested avoiding Supabase idle-project suspension, and confirmed an existing Cloudflare account.
- User completed Cloudflare sign-in. A mistaken stop interpretation was corrected by the user; implementation resumed from saved files.
- Live browser verification succeeded: `https://blindrunning.com/` loads the B.R.P homepage with signup and check-in links. Earlier command-line DNS failure was environment-specific, not evidence of site downtime.
- Cloudflare dashboard confirms Workers Free and an existing enabled R2 subscription. No upgrade or purchase was made.
- Existing Netlify public deploy page reports `main@70ed3dd`, last deployed from Netlify Drop. Its build log explicitly fetched Git `refs/heads/main`, with base and publish both `B.R.P Website` and no build command. Current auto-deploy settings are not yet verified; do not assume pushing a branch publishes the site.
- B.R.P clean baseline was isolated to `.brp-hosted-control`, branch `codex/hosted-blindbalance`, commit `70ed3dd`. Firmware source has preexisting local changes and is worked in place, preserving those changes.
- A local firmware baseline is retained under ignored `.build/hosted-control-baseline`; no live firmware was flashed.

## Baseline checks

- Apps Script mock suite: 5 passed.
- Existing C++ timing, alert-window, telemetry worker failure/queue/slow/timeout/redirect cases: passed.

## Active ownership

- Backend agent: `.brp-hosted-control/cloudflare/`.
- Firmware agent: production `Jul27` files, new cloud-specific tests/config/docs.
- Frontend agent: B.R.P control UI, public build tooling/config/tests/navigation.
- Coordinator: integration and review, deployment inventory, shared docs. No production deployment yet.

## Shared contract clarifications

- `commands[].results.L/R` are objects `{result:'applied'|'failed',message?}`.
- Firmware reports `status.commandedPwm` (0–255). UI distinguishes this software output from physical vibration confirmation and from `motorEnabled`.
- Optional `feedbackEligible` is separate from peer freshness.
- Disable applies zero output before acknowledgment; a boolean setting alone is not completion.

## Rulings

- Cloudflare replaces Supabase; backend account/provider references in the original design are superseded by the implementation plan. Protocol boundaries preserve portability.
- Individual high-entropy operator access keys avoid a further identity provider; keys remain memory-only in the browser and hashes only in D1. Lost keys require administrative reissue.
- Existing research/history dashboard repair remains a follow-on; this migration changes controls and device maintenance, not stored participant/research records.

## Remaining gates

Physical device configuration/flashing and two-board timing/behavior validation remain. The website/backend publication and authenticated browser checks are complete. Passing simulated tests does not establish hardware readiness.

## Implementation and review evidence

- Hosted frontend, Worker/D1/private R2 backend, and production firmware source are implemented. Cloudflare resources and deployment are verified below; no hardware flash occurred.
- Frontend/root tests: 21 passed, including 3 real-Worker/SQLite integration scenarios. Explicit public build allowlist outputs 18 files and excludes private configuration/backend source. Desktop/mobile unconfigured-page checks passed; authenticated UI verification remains.
- Backend: 17 tests and Wrangler 4.152.0 dry-run packaging passed. Tests cover scoped authentication, atomic commands, concurrency, boot/sequence/ACK handling, paired confirmation, and bounded private checksum-verified uploads.
- Independent review found a float32 interoperability bug at sensitivity 0.3. Device status now accepts only the representable float32 upper-bound overshoot and normalizes it to 0.3; operator command validation remains strict. Regression verifies both arm confirmations, and rejects larger values.
- Review found that capture storage/recovery errors left Start enabled. The frontend now disables Start and explains storage failure or preservation of a file requiring recovery; regression passes.
- Review found that a sample timestamp just before capture start could underflow elapsed time and stop recording immediately. Firmware now classifies pre-start timestamps separately, with native rollover/boundary regression. Independent reviewer verified all three fixes and reported no remaining findings.
- Existing native timing/alert/worker suites and Apps Script 5-test suite continue to pass. Final ESP32-S3 default-unconfigured right (1,079,235 flash bytes / 45,832 static RAM bytes) and left (1,079,527 / 45,832) builds passed; source/binary hashes and artifacts are retained in `.build/cloud-build-results.json` and `verified-cloud-*`. A synthetic configured-code link check is also running. Default partition compilation does not establish required LittleFS capacity.
- User explicitly approved Wrangler authorization and backend deployment. Verified scopes: User Read, Background Access, Account Read, Workers Write, Workers Scripts Write, and D1 Write. The approved second OAuth attempt succeeded. Optional browser observation of Cloudflare's post-login welcome domain was auto-review blocked; authorized CLI operations work. No paid activation occurred.

## Remote deployment and remaining publication approval

- Worker: `https://blindbalance-control.debutgacc.workers.dev`, version `95fe5309-f8ff-4864-9af5-e479cc36892f`.
- D1: `blindbalance-control`, ID `568260fa-b704-49a3-a382-a844965e1b5f`, schema `0001_control.sql` applied remotely.
- R2: `blindbalance-captures`; Wrangler confirms `r2.dev` public access disabled. Existing unrelated `portfolio` bucket was untouched.
- Deployed smoke tests passed using dedicated `deployment-smoke-20261023`: authentication/role/CORS checks, paired motor setting and float32 sensitivity, capture start/stop plus verified 25-byte private upload/download, and reboot invalidation. Five commands, one capture, revision 5. Keys remain valid temporarily for browser QA and must be revoked afterward.
- B.R.P source is committed/pushed on `codex/hosted-blindbalance`. Draft PR: `https://github.com/WhateversOnMyMind/B.R.P/pull/1`. Head after smoke tooling/docs: `1d497df`.
- Netlify automatically built the PR preview: `https://deploy-preview-1--bucolic-entremet-c4a700.netlify.app/control/`. This verifies current Git integration. Existing routes and control assets return 200; `/control/*` uses `no-store`; `/meta.env` and `/cloudflare/wrangler.jsonc` return 404. Desktop/mobile signed-out page verified.
- Auto-review rejected adding the preview origin to production CORS without explicit user permission. No rejected mutation executed. A specific pending request asks to add this exact origin temporarily, verify with the synthetic test pair, merge PR #1 to publish `/control/`, then remove the preview origin. Do not proceed with these dependent steps until approval arrives.
- Local static preview server was stopped; the Netlify preview is the review surface.

## Final verified state — 2026-10-24 Asia/Seoul

- User approved temporary preview CORS, synthetic-pair browser verification, PR merge/publication and removal of temporary permission. Authenticated preview showed stored command results, disabled stale controls, verified the private CSV download, and cleared private state on sign-out.
- PR #1 merged at `2938c457afde6e0a5bc10c62e62cc7f46b9a41cc`. `https://blindrunning.com/control/` returns 200 with `no-store` and the new page. Real `blindbalance-main` operator sign-in succeeded in the live browser; it is waiting for the two unflashed boards.
- Final Worker version `ad895b79-244b-4647-86bb-a15a9b1ee8be`. CORS is back to the two production origins. Verified former preview origin returns 403, and revoked disposable test key returns 401. All three smoke-pair credentials were revoked; synthetic records are retained for evidence.
- Real pair `blindbalance-main` has devices `blindbalance-left` and `blindbalance-right`, revision 0, no device exchanges yet. Private credentials/configs are under `cloudflare/provisioning/blindbalance-main-bb112c28-0d08-4509-9efd-b047492f4920/` in the B.R.P worktree. `operator-key.txt` contains only the operator key. `CloudConfig.L.h` / `CloudConfig.R.h` contain the distinct device keys, shared random pairing keys and verified TLS root; peer MACs intentionally remain zero.
- Firmware final normal right/left builds and synthetic-enabled right build all passed. Enabled build uses 1,114,491 flash / 45,912 static RAM bytes. `.build/cloud-build-results.json` records exact source/binary hashes; no firmware was flashed. Existing telemetry/alert source hashes match the pre-migration baseline.
- Remaining one-time setup: identify both boards' actual station MACs, fill each other's peer MAC in private per-arm headers, confirm correct arm flag and adequate filesystem partition on the physical boards, then flash and bench-test. Until then the website correctly leaves device controls disabled. Do not flash the default-unconfigured or synthetic test binaries.
