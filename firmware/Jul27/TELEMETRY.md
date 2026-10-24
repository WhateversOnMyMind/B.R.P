# Ten-second measurement windows

The measurement loop closes a window every 10 seconds from the end of startup calibration. It copies that window's count and distance into a queue and immediately starts the next window. A separate FreeRTOS task performs Google Sheets HTTP requests. Request duration no longer extends the measurement period or blocks IMU updates.

The Sheets payload is `{arm, count, distance, alerted}` with distance in centimetres and a boolean indicating commanded alert output during the window. See `apps-script/README.md` for the updated receiver and deployment. Toggle events retain `{event, state, ts}` and capture `ts` at the time of the action. The server and spreadsheet can still receive/display rows at irregular times. Receiver timestamps are not acquisition timestamps.

## Diagnostics

Serial output includes:

- `[window]`: boot/session ID, job sequence, actual window start/end, deadline lateness, missed deadlines, queue result/depth, drop count, maximum sampling gap and invalid-gap count.
- `[upload]`: the corresponding job ID, action/capture time, HTTP start/end/duration and result code.

`GET /state` also exposes `telemetryReady`, `uploadBusy`, `uploadQueued`, `uploadDropped`, `uploadFailed`, `uploadUnconfirmed`, `uploadSucceeded`, `lastUploadMs`, `lastHttpCode`, `windowStartMs`, `windowEndMs`, `windowLateMs`, `windowMissedDeadlines`, `maxSampleGapUs` and `sampleGapCount`.

HTTP 2xx means the transport returned success, not that the spreadsheet row was independently verified. HTTP 3xx is counted as unconfirmed because Apps Script may write a row before redirecting the response. Negative codes or other HTTP errors count as failures; `-1000` means offline or HTTP initialization failed.

## Failure policy

- Twelve jobs can wait, plus one in-flight request. Window and toggle records share this queue.
- A full or unavailable queue drops the new record and increments `uploadDropped`. Sensing never waits for queue space.
- An offline or failed upload is reported and discarded. There are no automatic retries, preventing duplicate rows when a server wrote data but its response was lost. This is bounded best-effort delivery, not durable storage.
- Connect and response timeouts are each 5 seconds; these are phase limits, not a guaranteed total request duration.
- Allocation failure leaves sensing enabled and reports `telemetryReady:false`.
- If some other operation stalls the measurement loop, one extended window records the real duration and the next deadline remains aligned. Missing time is never fabricated into multiple rows.
- Sample intervals above 100 ms cancel an unfinished swing and skip integration for that reading, preventing a large false arc from missing samples. `micros()` subtraction handles 32-bit rollover.

Raw flash logging, raw-log downloads and manual recalibration can still delay the main loop. This change removes HTTP uploads from that loop; it does not make sampling hard real-time. Validate the 100 ms gap guard and measured jitter on the assembled boards before research trials.

## Verification and flashing

Run `tests/run-tests.ps1` for native C++ timing tests and the production worker against fake ESP32/HTTP boundaries. The fakes exercise payloads, failures and queue behavior without contacting the live Sheet; they do not emulate real FreeRTOS scheduling, TLS, radio traffic or hardware.

Compile the complete sketch directory for ESP32-S3. Keep `Telemetry.cpp`, `Telemetry.h`, `TelemetryTiming.h`, `AlertWindow.h`, `RawLog.ino`, and `WebUI.ino` alongside `Jul27.ino`. Select the arm using the existing `ARM_IS_LEFT` toggle. Nothing in the verification scripts uploads firmware. `TELEMETRY_BUILD_RESULTS.json` records the earlier cadence-only revision; `ALERT_BUILD_RESULTS.json` records the subsequent alert-logging revision.

After flashing, capture at least five minutes of `[window]` and `[upload]` logs on both boards. Expect nominal 10,000 ms boundaries with small loop jitter, even when request durations vary. Check maximum sample gaps, peer feedback, toggles, queue/error counters, and piezo behavior on the newer revision. Actual hardware timing and backend row persistence require that bench check.
