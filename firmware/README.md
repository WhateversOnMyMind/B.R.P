# B.R.P hosted firmware

Choose the folder matching the board's output hardware:

| Hardware | Sketch | Output |
| --- | --- | --- |
| Piezo | `Jul27/Jul27.ino` | 4 kHz beeps with variable cadence |
| Vibration motor | `Jul27Motor/Jul27Motor.ino` | PWM strength from 0 to 255 |

Both variants use Cloudflare without Google Sheets. The control page
recognizes each variant automatically; matching hardware is required for
shared pair commands. Motor setup is in `Jul27Motor/README.md`.

## Piezo version

Open `Jul27/Jul27.ino` for the piezo hardware used by
https://blindrunning.com/control/. This tree combines the existing Composite
Board rev. C piezo implementation with authenticated Cloudflare control.

- Piezo: GPIO 14, 4 kHz, bounded 70 ms beeps. Increasing imbalance shortens the
  interval between beeps from approximately 1,000 ms to 200 ms.
- Balance calculation and ESP-NOW exchange: every 5 seconds. Peer timeout:
  6 seconds. Disable, calibration, and stale peer state suppress output.
- IMU: ICM-42688-P on SPI pins 8/9/10/11, nominal 250 Hz processing.
- Magnetometer: MMC5983MA on I2C SDA 4 / SCL 5, nonblocking measurements.
- Measurement summary: every 10 seconds; the latest count, distance and commanded
  beep activity are included in Cloudflare status. See `Jul27/TELEMETRY.md`.

This hosted firmware uses Cloudflare for control, status and saved raw captures.
No Google Sheets or Apps Script setup is needed. Ten-second summaries are latest
status only; saved raw captures provide downloadable records.

The original motor firmware remains in the separate `blindbalance` repository
at `hellyeah/Jul27`. It also compares balance every 5 seconds. Do not use that
motor sketch for the hosted piezo pair.

## Configuration and building

Follow `Jul27/CLOUD_CONTROL.md` and `../cloudflare/README.md`. Use distinct device
credentials, the same pair keys, and the other board's station MAC on each arm.
Select `ARM_IS_LEFT` for the left board. Keep provisioned `CloudConfig.h` and
compiled binaries private. Copy `WifiConfig.example.h` to ignored `WifiConfig.h`
and set the shared Wi-Fi/hotspot credentials there.

For a first-board bring-up, valid API/device credentials and the CA certificate
are sufficient to connect. Leave the unknown peer MAC as all zeroes: peer radio
setup and balance beeps remain disabled until the other board is configured and
reporting. The website can show the single board online and recalibrate that arm;
shared piezo/sensitivity controls still require both arms online. Each arm must
use its own matching device key and arm selection. Capture additionally requires
the LittleFS setup described below; first verify online status and recalibration.

From `firmware/Jul27`, run:

```powershell
./tests/run-tests.ps1
./tests/build-cloud.ps1
./tests/build-cloud.ps1 -Arms right -LinkTest
```

The last command uses unusable synthetic credentials only to verify linkage.
Never flash its binary. Compilation does not upload firmware. Choose a partition
with sufficient LittleFS capacity before a physical capture test, as described
in `CLOUD_CONTROL.md`.

## Existing API compatibility

The deployed API retains `motorEnabled` and `set_motor_enabled` as wire names;
for this firmware they enable piezo feedback. No database migration is needed.
Devices identify themselves with `actuator: "piezo"` and report
`feedbackIntensity` (0–1), `toneActive`, `toneHz`, and `pulsePeriodMs` (zero while
ineligible/silent). The page never interprets legacy motor PWM as piezo output
and disables control of unrecognized firmware. Tone state is a snapshot of a
command, not a microphone measurement; short beeps may occur between heartbeats.

## Source provenance

The piezo envelope, pulse scheduling, and MMC5983MA driver were taken from the
existing `Composite Board rev. C/piezo_version/firmware` sources. The hosted
adapter adds calibration suppression and preserves bounded pulses, alert
accounting, sensor processing, capture uploads, and authenticated peer settings.
The website migration's previous motor source and pre-migration snapshots are
retained locally in ignored build directories, not published as firmware builds.
