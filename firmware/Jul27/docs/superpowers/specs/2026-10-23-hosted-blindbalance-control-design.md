# Move BlindBalance controls to blindrunning.com

Date: 2026-10-23, Asia/Seoul. Status: user approved implementation; Cloudflare replaces the initially proposed Supabase because the user wants to avoid idle-project reactivation. Work is in progress under `../plans/2026-10-23-cloudflare-control.md`; that plan defines the exact wire contract and supersedes earlier provider details. Independent builder review found no important gaps preventing implementation planning. Deployment and physical bench validation remain explicit gates.

## Intent and confirmed scope

Use the existing B.R.P website at blindrunning.com for BlindBalance control instead of serving the control interface and APIs on the ESP32s. The user confirmed internet is available through Wi-Fi or a hotspot. This concerns the running firmware in `hellyeah/Jul27`, not the separate USB demo in `Jul27/demo`.

Retain on-device sensing, swing detection, feedback calculation, and ESP-NOW peer communication. The website sends configuration commands; it does not drive the motor timing loop. Preserve the existing signup and check-in flows.

## Inspected baseline

- Website: `C:/Users/debut/B.R.P/B.R.P Website`, GitHub repository `WhateversOnMyMind/B.R.P`, default branch `main`. Local and GitHub `netlify.toml` agree: an ignore-build override and asset processing setting, but no explicit base/publish directory. Netlify's effective project settings still need inspection.
- `home.html` links to signup/check-in but not the existing `/data/` dashboard. No root `index.html` was found. Determine the current root routing before changing it.
- `WebUI.ino`: both boards serve `/state` and `/recalibrate`; the left also serves HTML at `/`, `/toggle`, and `/sensitivity`. The page polls both arms every 1.5 seconds, using `bb-right.local` for the right board. The recalibration endpoint exists but has no button in the current page.
- `RawLog.ino`: each board supports start, stop, download and clear. Starting opens the one existing file with truncation. Recording has approximately 3-minute/2-MB caps. Downloads currently stream through the synchronous web server.
- `Jul27.ino`: left is authoritative for motor enable and sensitivity. The right adopts those settings in ESP-NOW packets. Feedback exchange is on a 2-second cadence. Peer freshness already gates motor output. Default motor enable is true on boot.
- `Telemetry.cpp` already moves blocking Sheets uploads into a bounded FreeRTOS worker. Current records are best-effort, not durable, and a 2xx response is not proof of a spreadsheet write. Preserve these distinctions.
- The site's `/data/index.html` uses a different Apps Script deployment from the firmware. It expects `{data:[{leftCount,rightCount,leftDistance,rightDistance,timestamp}]}`. The checked-in firmware receiver instead returns one latest `{arm,count,distance,timestamp,alertedArm}` record, optionally filtered by arm. Endpoint/schema reconciliation is required; switching a URL alone will not work.
- Live browser verification now succeeds: `https://blindrunning.com/` loads the B.R.P homepage. Earlier web-tool and command-line DNS failures were specific to those environments. Netlify's public deploy page identifies production `main@70ed3dd`; current effective build and publish settings still need verification.
- Source files were read successfully. Local Git status for B.R.P was blocked by the current sandbox, so no clean-working-tree assumption is made. No website, firmware, backend, DNS or production settings have been changed.

Older August local-web design documents describe the prior architecture. Current source and the user's request take precedence for this proposal.

## Recommended architecture (assistant recommendation)

Keep plain HTML/CSS/JavaScript on the existing Netlify project and add `/control/`. Use Cloudflare Workers for the authenticated HTTPS API, D1 for command/status records and credential hashes, and private R2 for finalized logs. The user has an existing Cloudflare account and completed sign-in. Read-only inventory shows Workers Free and an already enabled R2 subscription; no new paid plan has been activated. Initial operator sign-in uses a distinct high-entropy pair-scoped access key retained only in browser memory; no further identity provider is introduced.

Flow:

1. An authorized operator opens `https://blindrunning.com/control/` and signs in.
2. The browser submits a validated command to the managed backend and receives a command ID.
3. Each board makes outbound authenticated HTTPS exchanges: publish a status snapshot and acknowledgments, receive commands for that device.
4. The firmware main loop consumes validated commands from a bounded queue; network calls stay in a separate worker.
5. The left board applies shared settings and sends the settings and their revision to its paired right board via ESP-NOW.
6. Each board reports its own applied revision. The browser shows success only when the required devices acknowledge it.
7. Completed raw captures upload to private object storage; the operator downloads them through an authorized expiring link.

The website never needs a private IP or `.local` address. The final firmware has no HTTP listener, embedded control page or mDNS dependency. Phones can use a different internet connection from the boards; the boards must retain a compatible Wi-Fi channel for their ESP-NOW link.

Why this approach: it removes board hosting and reuses the existing website while keeping networking outside the measurement loop. A hosted page that still fetches local board APIs would retain the ESP32 servers and browser local-network restrictions. Using Apps Script/Sheets as a frequent command queue would mix research data with control and require a separate design for acknowledgments/concurrency. A managed MQTT broker is a reasonable alternative if HTTPS polling fails latency/load testing; it adds another integration and is not the initial recommendation.

## Command and status contract

- Identify every device by a stable device ID and assigned pair ID; an arm label alone is insufficient. Bind the expected peer MAC/device during provisioning so unrelated left/right pairs cannot control one another through the existing broadcast handler.
- Use explicit `set_motor_enabled(true/false)` and `set_sensitivity(value)` commands, not a retryable toggle. Validate finite sensitivity in the existing 0–0.3 range.
- Left is the only executor for shared settings; reject direct right-board commands for those settings. Per-board raw-log and recalibration commands target the selected arm.
- Include command ID, pair/device scope, action, arguments, expected boot ID, issued/expiry timestamps and monotonic revision. Use compare-and-set on the current revision to reject stale edits by another browser. Backend authorization and board validation are both required.
- Default command expiry: 15 seconds. Do not queue controls for devices already considered offline. Exchange server time plus remaining TTL; the board enforces a monotonic local deadline rather than trusting unsynchronized wall time. New boots invalidate pending commands. Expired or superseded commands cannot be replayed after reconnect.
- Persist or retain command results for the active boot and repeat the result when a command ID is redelivered. Never execute start/clear/recalibrate twice because an acknowledgment was lost. Record an execution claim before work; after a reboot report uncertain old operations instead of replaying them. Raw operations include a capture ID and expected file generation to prevent deleting or overwriting the wrong file.
- Browser states: pending, applied per arm, failed, expired and outcome unknown. A successful HTTP submission only means accepted. For shared controls show partial application until both boards acknowledge the same revision. No claim that both devices change atomically.
- ESP-NOW carries a versioned settings revision; right-board status reports the revision it actually adopted. Update and flash both firmwares together; reject incompatible packet versions. Validate sender identity and the paired peer, not just the `L`/`R` character.
- Report the current motor-enable setting separately from commanded PWM/output and peer eligibility. Preserve that `alertedArm` records commanded output, not physical confirmation of vibration.
- Preserve status fields already exposed by `jsonState()`, including upload queue/error counts and sampling-gap diagnostics. Add device/pair ID, boot ID, applied revision, capture ID, last command result and backend receipt time.
- Initial exchange target: every 2 seconds per board, with bounded timeouts and exponential backoff on failures. This is a tuning proposal, not a latency guarantee. Two always-on boards produce about 86,400 exchanges/day at this cadence; check provider quotas/cost and hardware performance before committing to it. Browser refresh can use a 2-second authenticated status read while visible.
- Initial UI stale threshold: 10 seconds without a backend-received heartbeat. Disable state-dependent controls and show age. Bench target is both-arm acknowledgment within 6 seconds on a healthy connection; measure it rather than promising it.

## Credentials and execution boundaries

Use individually revocable operator access keys assigned to a pair, with server-side authorization on every route. Only SHA-256 verifier hashes are stored in D1; raw keys are generated into an ignored local provisioning directory. D1 and R2 are available solely through Worker bindings, without a public database or bucket endpoint. Public site visitors can still use signup/check-in but cannot control boards or read private captures.

Provision distinct revocable device credentials outside the public repository; store only verifier material server-side. Device endpoints authenticate those credentials and enforce exact device/pair scope. Browser login credentials and device credentials have separate roles. Cloudflare administration credentials are never put in device firmware or browser assets. ESP32 HTTPS must validate server certificates. Secrets must not be copied into static assets or the existing `meta.env`; its contents were not inspected in this review.

The control worker exchanges immutable state snapshots and bounded command queues with the measurement loop. It must not mutate sensing state or touch LittleFS concurrently from network callbacks. Preserve the existing Sheets worker; control traffic cannot wait behind a slow Sheets request. Set memory, connection and queue budgets, and expose failures instead of blocking when queues fill.

## Operation during outages and reboot

During an internet outage, new website controls are unavailable. Running boards retain the last applied configuration and continue local measurement/ESP-NOW feedback subject to existing peer-staleness behavior. Expired cloud commands never execute on reconnection. The website must visibly show loss of contact; it cannot act as an emergency stop during an outage.

Retain current boot behavior initially (motor-enabled default true, feedback still gated by valid peer data); display the reboot and require fresh commands. Do not silently restore a previous browser's desired state. This preserves behavior rather than introducing an unrequested offline or boot policy. Existing startup waits for Wi-Fi remain a known limitation; internet loss after startup and Wi-Fi/AP loss are distinct bench cases.

## Raw logs and recalibration

Retain short local captures and existing caps. Make capture status report the stop reason and durable byte count. Start must not silently truncate an undownloaded capture; require an explicit replacement decision and capture ID. Stop finalizes the file before upload. Transfer only finalized files using bounded chunks from a worker with explicit filesystem ownership; never load the whole file into RAM. Keep the local file until storage confirms completion and size/checksum. An interrupted upload is retryable using the same capture identity; never label a partial object downloadable.

The first implementation can retry a complete bounded capture instead of implementing a resumable protocol, provided memory stays bounded. Only clear a matching stopped capture. Clear-local and delete-cloud are separate operations; downloads require pair authorization. Schedule bulk transfers outside active capture/measurement sessions to limit radio and flash contention. Retain serial-based maintenance access during rollout until hosted download parity is proven.

Current `recalibrateSoft()` blocks for repeated samples and delays. Do not invoke it from a network thread. Convert it to a main-loop state machine that accumulates valid still samples, reports progress/failure and preserves counts/windows. Expose it as an explicit maintenance operation; acceptance requires no new large sampling gaps. Keep continuous full-trial raw streaming out of scope.

## Website/data changes

Add `control/index.html`, `control/control.js`, `control/style.css` and a small public configuration module containing only public backend identifiers. Use relative assets and same-site navigation. Add a clear Control link and Data link to `home.html`; preserve signup/check-in routes. Include keyboard access, labeled controls, textual per-arm state and non-color-only errors.

Keep `/data/` for historical measurements. First verify which deployed Apps Script contains the intended dataset using read-only requests. Then define a versioned paginated history API and an adapter for per-arm records; retain legacy records where relevant. The checked-in `doGet` returns only the latest row, so historical charts require an actual history endpoint. Preserve timestamps, units in centimetres and `alertedArm`; do not silently convert malformed values or a missing arm to zero. Shared trial/session selection is required before calling the dashboard's all-time data a session. Deliver control migration first; history repair is a separate follow-on with its own dataset validation.

Preserve existing 10-second Sheets telemetry and action markers. A new explicit motor command emits a marker only when a setting actually changes, and backend acknowledgments record actual application time independently of Sheets delivery. Deduplicate commands; do not introduce blind retries to the legacy Sheets receiver.

## Migration sequence and affected files

1. **Deployment inventory:** inspect existing Netlify linked repo/branch, base/publish directory, domain/TLS, root route and deployed assets. Check local edits before changing B.R.P. Verify backend access and select the hosted provider/plan with the measured polling budget. Do not publish `meta.env`, IDE files or firmware sources; generate an explicit deploy-only asset directory if needed.
2. **Managed service:** add versioned D1 migrations and a Cloudflare Worker under `cloudflare/` in the B.R.P repository, outside static publish assets. Implement pair membership, device provisioning, command lifecycle, atomic revisions, status snapshots and private R2 captures. Verify authorization, expiry, duplicate delivery and acknowledgment behavior with synthetic devices first.
3. **Firmware transport:** add `CloudControl.h/.cpp` alongside `Jul27.ino`; reuse state serialization through a shared snapshot interface. Refactor actions out of HTTP handlers, implement queued execution/idempotence, and extend/version `PeerMsg`. Preserve `Telemetry.*`, `TelemetryTiming.h` and `AlertWindow.h` behavior. Keep local web support temporarily behind a migration flag for bench rollback; no local endpoint is part of the final hosted flow.
4. **Hosted controls:** add `/control/` and navigation in B.R.P; connect operator login and the managed API. Display per-arm actual state, stale status, pending/results, sensitivity and maintenance actions. Verify from a Netlify preview with simulated devices before touching a physical board.
5. **Complete maintenance parity:** refactor `RawLog.ino` away from `WebServer`, add capture IDs and safe uploads/downloads/clear, and implement nonblocking recalibration. Prove firmware behavior on both boards.
6. **Cut over:** deploy the hosted page/backend, provision and flash both boards, run a full paired bench session, then disable/remove `WebUI.ino` HTTP/mDNS setup and `webUiHandleClient()` from `Jul27.ino`. Keep the shared action/snapshot code. Confirm no port-80 listener remains and all primary flows work from the public site. Update firmware/operator documentation and explicitly supersede the August local-web plan.
7. **History follow-on:** reconcile `/data/index.html` with the actual deployed measurement API without mixing event-registration data or moving existing research records by default.

Rollback: preserve the known-good paired firmware and Netlify deploy before cutover. Revoke/expire queued cloud commands before rollback. Roll back both boards together if peer packet versions change. Do not delete captures or alter Sheets history during rollback.

## Acceptance checks for implementation

- Desktop and phone open `/control/` over HTTPS; no local URL, local server process, USB connection or board-hosted HTML is involved.
- Unauthorized users/devices and wrong-pair requests cannot read status/captures or issue controls. Credentials never appear in deploy assets.
- Test explicit on/off, sensitivity limits, simultaneous editors, duplicate commands, acknowledgment loss, command expiry, stale status, reconnect and reboot. Each operation displays its real per-arm result.
- Capture start/stop/upload/download/clear works on each board; compare downloaded checksum/length with the finalized source. Test upload failure and duplicate start/clear without data loss.
- Compile both arm configurations. Run existing C++ timing/worker/alert suites (`Jul27/tests/run-tests.ps1`) and Apps Script mocks (`node --test Jul27/tests/apps_script_test.mjs`), plus focused new command/state tests.
- On physical boards compare baseline and new sample-gap counts, maximum gaps, 10-second window boundaries, ESP-NOW freshness, motor output and upload queues over at least five minutes, including network stalls and recalibration. Synthetic tests cannot prove scheduling/radio behavior.
- Load existing home/signup/check-in/data routes in preview and production. Any test submission must target test data, not live participant registrations.
- Verify deployed DNS/TLS and the final production hostname from an actual browser. The current inspection did not establish live availability.

## References checked

- [Netlify monorepo/base/publish configuration](https://docs.netlify.com/build/configure-builds/monorepos/)
- [Chrome Local Network Access](https://developer.chrome.com/blog/local-network-access): public-site access to local devices has browser permission requirements; moving HTML alone does not remove the local transport dependency.
- [Cloudflare Workers pricing and request limits](https://developers.cloudflare.com/workers/platform/pricing/)
- [Cloudflare D1 pricing and limits](https://developers.cloudflare.com/d1/platform/pricing/)

Polling/expiry values and URL `/control/` are engineering defaults. Confirmed requirements are use of the existing website, replacement of ESP32 self-hosting, available internet, and avoiding Supabase idle-project suspension. The existing website has been verified in the browser; no claim is made that the new control backend is already deployed or hardware-tested.
