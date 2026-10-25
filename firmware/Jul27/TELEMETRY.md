# Ten-second measurement windows through Cloudflare

The measurement loop closes a window every 10 seconds from the end of startup
calibration, preserving its count, distance and commanded piezo activity before
resetting the counters. This is independent of the five-second balance comparison.
The existing background Cloudflare task sends the latest snapshot with its normal
authenticated `/v1/device/exchange` request. There is no Google Sheets uploader,
Apps Script receiver, separate telemetry HTTP task or spreadsheet configuration.

## Latest status

The operator state API returns each board's latest accepted status, including:

- `windowReady`: false until the first measurement window closes.
- `windowSequence`: completed-window sequence within the current boot.
- `windowCount` and `windowDistanceCm`: swings and distance in centimetres.
- `windowAlerted`: whether piezo output was commanded during that window. This is
  not a physical sound measurement; use the device arm to identify the alerting arm.
- `windowStartMs`, `windowEndMs`, `windowLateMs`, `windowMissedDeadlines`: actual
  acquisition boundaries and timing diagnostics, in board uptime milliseconds.
- `maxSampleGapUs` and `sampleGapCount`: sampling-gap diagnostics.

The status response shows the latest window. After backend migration
`0002_measurements.sql` and its Worker deployment, each received completed window
is also archived once in D1 by device, boot and window sequence. At `/control/`,
**Automatic logs** lets an operator choose a local date and download saved count,
distance and commanded-alert summaries as CSV. This happens without raw-capture
Start/Stop or an open browser, and needs no firmware change.

Offline periods, slow requests or capture uploads can still cause intermediate
windows never to reach the server: the firmware retains only its latest summary.
History starts with the new backend; previously overwritten windows cannot be
reconstructed. Server receipt time (UTC in CSV) is separate from board-relative
acquisition boundaries. Saved raw captures remain downloadable through Cloudflare
R2; they require the LittleFS setup described in `CLOUD_CONTROL.md`.

Feedback-setting changes are tracked by Cloudflare command acknowledgments.
The old Sheets event queue and its upload counters are no longer used.

## Timing and diagnostics

Serial `[window]` lines show boot ID, sequence, start/end, lateness, missed deadlines,
count, distance, commanded alert state and sample-gap metrics. The old `[upload]`
lines and their `code=-1000` no longer exist. A window line confirms measurement
only; check the website's Fresh status to confirm Cloudflare connectivity.

Sensing never waits for network requests. If the loop stalls, one extended window
records the actual duration; it does not fabricate catch-up records. Sample gaps
above 100 ms cancel an unfinished swing and skip that integration step. Unsigned
uptime subtraction handles timer rollover. Filesystem and radio activity can still
affect hardware timing; this is not a hard real-time guarantee.

## Verification

Run `tests/run-tests.ps1` for measurement timing, alert windows, piezo scheduling,
command guards, peer validation, capture timing and cloud-configuration checks.
Run the website and Cloudflare test suites from their respective package folders.
Compile the complete sketch for ESP32-S3 with its matching arm and private config.
Verification scripts compile only; they never upload firmware.

After flashing, check several minutes of `[window]` logs, nominal 10,000 ms
boundaries and sample-gap counters. Verify the board appears Fresh on the hosted
page and that recalibration is acknowledged. Balance feedback requires both arms.
