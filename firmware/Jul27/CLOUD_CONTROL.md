# Hosted piezo control firmware

This hosted-control firmware connects outward to the Cloudflare `/v1` API. It does not
start WebServer, expose raw-log routes, or register mDNS. `demo`, the historical
dashboard, and the existing 10-second Sheets transport remain separate.

## Source location after the 2026-10-24 move

The hosted-control sketch is now in `.brp-hosted-control/firmware/Jul27` under
`C:/Users/debut/blindbalance/hellyeah`. The original sibling `Jul27` folder has
been restored from the pre-website backup; all seven original firmware source
files match that backup byte-for-byte. Its existing telemetry and alert work is
preserved. Use this hosted folder for future website-integration firmware work.

Hosted tests, planning notes, and cloud build artifacts moved with this sketch.
Existing build reports and planning notes retain historical paths from before
the move; their `.build` artifacts are now in this folder. The relocation hashes
are recorded in the local `../restoration-manifest.json`. Native and Apps Script tests
passed in both locations after the move. No board was flashed during relocation.

On 2026-10-24 this hosted tree was adapted to the existing piezo firmware. See
`../README.md` for pins, pulse timing and API compatibility. The original motor
source remains in `blindbalance/hellyeah/Jul27`; its feedback interval was
subsequently changed to five seconds at the user's request. The restoration
hashes describe the earlier restoration, not those subsequent edits.

## Provisioning

1. Deploy/provision the matching Worker, D1, private R2 bucket and pair/device
   credentials using the website worktree's `cloudflare/README.md`. Check account
   limits before choosing a production polling interval: the default is two
   seconds per device.
2. Copy `CloudConfig.example.h` to ignored `CloudConfig.h`. Supply the exact HTTPS
   API base, a distinct device bearer key for this arm, and the PEM CA trust
   anchor for that hostname. Empty/partial configuration leaves cloud control
   disabled. TLS hostname and certificate validation are mandatory; there is no
   insecure fallback or automatic redirect following. Working NTP is required.
3. Provision the same nonzero uint32 pair ID and random 16-byte PMK/LMK on both
   boards; each board stores the **other** board's Wi-Fi station MAC. These are
   application pairing settings, independent of the backend's textual pair ID.
   Both boards must use this firmware protocol. ESP-NOW uses encrypted unicast
   and a 128-bit truncated HMAC-SHA256 tag over the complete versioned packet.
   Wrong MAC, pair, arm, version, tag, sequence or invalid setting is rejected.
4. Choose `ARM_IS_LEFT` for left or leave it undefined for right. Set Wi-Fi as in
   the existing sketch. Do not publish private headers or compiled provisioned
   binaries. Rotate a compromised device token in D1 and re-provision that board;
   rotate the peer keys on **both** boards if either peer key is compromised.
5. Use a partition table with at least 2,000,160 bytes available to LittleFS plus
   filesystem overhead, and enough application space. Provision the filesystem
   separately on a bench. Mount failure never triggers an automatic format.

Firmware compilation or local tests do not provision, publish, or flash anything.

## Ownership and execution

The sensing loop alone owns settings, swing integration, piezo tone commands and
calibration. Its cloud interface exchanges fixed-size queue values; it performs
no HTTP or filesystem operations. A background network task performs one HTTPS
exchange at a time, reduces command lifetime by elapsed request time, and retries
failed requests with a capped 30-second backoff. Replies are bounded to 4 KiB.
Acknowledgments survive network failures until accepted; a definitive HTTP 409
rejection is discarded so it cannot permanently block fresh status.

Shared settings execute only on the left. Absolute `set_motor_enabled` values
replace toggles, and changed feedback settings retain the existing Sheets event
format. Disable immediately stops the piezo tone. The left sends the command's
`settingsRevision` over the authenticated peer link; the right adopts settings
without decrementing its revision. The server confirms both actual applications.
After a left reboot, a still-running right retains its previous revision/settings
until a newer explicit shared command arrives. The UI can show that disagreement.

`motorEnabled` is the existing API name for enabling piezo feedback.
`feedbackIntensity` sets beep cadence; `toneActive` reports a commanded tone.
`feedbackEligible` means enabled, peer fresh and not calibrating, **not** proof
that physical sound is audible. Feedback comparison and peer exchange run every five seconds. Peer silence
uses a six-second cutoff (the feedback window plus one second) and stops output
on the next sensing iteration.

Calibration settles for 400 ms, then accumulates the normal samples for two
seconds. Sensing, raw recording, status, peer traffic and Sheets window closure
continue. Haptic output is suppressed during calibration. Its acknowledgment is
sent only after the new bias is applied. Commands with insufficient remaining
lifetime are rejected before starting calibration.

## Captures and power interruption

A separate worker owns all CSV writes. A 96-row queue bounds RAM use, with
`captureDropped` reporting queue overflow. Capture stops at three minutes or
2,000,160 bytes; no row may cross that byte bound. The capture ID is the issued
`raw_start` command UUID, persisted before the file is created. A new start never
overwrites an existing capture. Stop/clear must name the exact current ID.

The network task uploads only a stopped file that matches the status it just
successfully exchanged. A file lease excludes start/clear while it hashes and
streams the immutable file. Upload uses exact Content-Length and lowercase
SHA-256; `captureUploaded` becomes true only after the response matches ID,
bytes and hash. The local file remains until an explicit matching clear. A clear
requested during an upload fails busy and may be retried after upload finishes.

After reboot, a valid persisted ID and existing file are recovered as stopped,
and may be re-uploaded idempotently. `captureUploaded` is not persisted; the
backend remains authoritative for completed uploads. A legacy CSV without an ID
or malformed identity sets `captureRecoveryRequired`; firmware refuses a new
start rather than destroying it. Recover/export that filesystem on a bench
before manually removing the orphan. Flash or storage failure may truncate the
last rows; the recovered byte count and hash describe the retained file.

## Verification and rollout

Run `tests/run-tests.ps1` and `node --test tests/apps_script_test.mjs`. Native tests
cover duplicates, wrong/restarted boot, stale revisions, deadline rollover,
finite/ranged sensitivity, left authority, capture generation checks, paired
identity and peer replay. The installed ESP32 core supplies cJSON and mbedTLS;
no additional Arduino library is needed.

Run `tests/build-cloud.ps1` to stage only top-level `.ino`, `.h` and `.cpp` files
and build both `esp32:esp32:esp32s3` arm variants. It reuses one build workspace,
preserves separate arm binaries/logs, and records staged source and binary
SHA-256 hashes in `.build/cloud-build-results.json`. Optional `-LinkTest` uses
synthetic credentials and an invalid CA in the ignored staging folder to force
the complete transport to link; **never flash link-test binaries**. There are no
real keys or usable backend endpoints in that mode. Do not recursively copy the
historical `.build` tree. The preserved pre-migration source snapshot is
`.build/hosted-control-baseline`; preserve it separately before cleaning build
artifacts. Rollback means intentionally building/flashing that prior source, not
enabling a second control authority in this firmware.

Before a production flash/cutover, bench-check both boards on the intended AP:

- Valid/wrong CA, missing token, revoked token, offline Wi-Fi, NTP failure and
  reconnect; verify no local HTTP listener and no credential logging.
- Duplicate/reordered/expired commands, a reboot during a pending command, peer
  loss, and shared commands with only one board reachable; no false pair success.
- Immediate disable, sensitivity synchronization and nonblocking calibration;
  inspect sample-gap counters during TLS, Sheets uploads and filesystem writes.
- A full three-minute capture, queue overflow diagnostics, stop/upload/clear
  races, power loss during capture, wrong hash, and lost upload responses.
- Physical piezo behavior and 10-second Sheets/alert windows on real hardware.

Flash latency can still briefly stall ESP32 instruction fetch even with separate
tasks; sample-gap counters and physical timing measurements are the rollout gate.
No claim of realtime timing, live deployment or physical actuation follows from
host tests or compilation alone.

## Historical motor-build verification on 2026-10-23

This section records the earlier hosted motor build. Current piezo build
results are generated by `tests/build-cloud.ps1` in the ignored `.build` folder.

All native suites passed: timing, ten telemetry-worker scenarios, alerts, cloud
command guards, peer identity/replay, and the capture-start race/rollover
regression. All five Apps Script tests passed. `Telemetry.cpp`, `Telemetry.h`,
`TelemetryTiming.h`, and `AlertWindow.h` match the preserved baseline byte for
byte. Independent review's capture-start race was reproduced by a failing test
and fixed before these final builds.

Arduino CLI 1.5.1 / ESP32 core 3.3.5, `esp32:esp32:esp32s3`, **default partition**:

| Build | Flash bytes | Static RAM bytes | Result |
| --- | ---: | ---: | --- |
| Right, unconfigured | 1,079,235 | 45,832 | Pass |
| Left, unconfigured | 1,079,527 | 45,832 | Pass |
| Right, synthetic configuration, complete cloud transport linked | 1,114,491 | 45,912 | Pass; never flash |

Exact staged source hashes, binary hashes, logs and artifact directories are in
`.build/cloud-build-results.json`. These checks did not contact a live cloud
endpoint, deploy the backend, flash either board, or validate filesystem capacity
and physical timing. The default partition build is not evidence of sufficient
LittleFS capacity for a full capture.
