# B.R.P hosted motor firmware

Open `Jul27Motor.ino` for the vibration-motor hardware. The piezo firmware stays
in `../Jul27`; the original standalone motor source stays in the separate
`blindbalance/hellyeah/Jul27` directory.

This version uses the same authenticated Cloudflare API as the B.R.P control page.
It has no Google Sheets uploader, Apps Script dependency, local web server or mDNS.
The control page recognizes `actuator: "motor"` automatically and displays
commanded PWM. The same page also recognizes the piezo variant.

## Hardware and behavior

- ESP32-S3 and ICM-42688-P: MISO 8, MOSI 9, SCK 10, CS 11; nominal 250 Hz sensing.
- GPIO 14 connects to the motor driver's input, matching the original motor code.
  This sketch requires the populated motor/driver circuit; it does not drive the
  piezo sounder. The motor is not powered directly from an ESP32 GPIO.
- Balance comparison and encrypted ESP-NOW exchange run every 5 seconds. The
  lagging arm receives PWM from 0 to 255, increasing with imbalance beyond the dead
  zone. Output remains at that level until the next comparison or an output guard.
- Disable, recalibration and an expired peer report stop output. Peer timeout is
  6 seconds. The output pin is held low during startup.
- Ten-second windows report count, distance in centimetres, and commanded motor
  activity to Cloudflare. The backend archives each received window once; download
  history from **Automatic logs** at `/control/`. Internet is needed to deliver
  windows; this firmware retains only the latest summary during an outage.
- Stopped raw captures upload to private Cloudflare R2 for authorized downloads.
  Capture storage requires a separately provisioned LittleFS partition with at
  least 2,000,160 bytes plus filesystem overhead. Mount failure never auto-formats.

## Configuration

1. Copy `WifiConfig.example.h` to `WifiConfig.h` and set the shared Wi-Fi/hotspot.
2. Copy `CloudConfig.example.h` to `CloudConfig.h`. Set the API URL, this arm's
   device key and trusted PEM CA certificate. The existing API is
   `https://blindbalance-control.debutgacc.workers.dev`.
3. Select the arm in `Jul27Motor.ino`: uncomment `#define ARM_IS_LEFT` for Left;
   leave it commented for Right. Use each arm's matching device credential.
4. Configure the same nonzero pair ID and random PMK/LMK on both boards, with the
   other board's Wi-Fi station MAC in each header. Both boards join the same AP.
   For one-board bring-up, leave the unknown peer MAC zeroed; online status and
   recalibration work, while balance output remains unavailable.
5. Build/upload for ESP32-S3 with USB CDC on boot enabled. Keep the board still
   during startup calibration. Check Fresh status, then per-arm recalibration.

No private headers are included in this folder. If motor and piezo pairs run at
the same time, provision a separate pair and unique device keys for the motor
boards; do not let two active boards use the same device identity. Shared website
controls require both arms to report the same actuator type.

## Verification

From this folder:

```powershell
./tests/run-tests.ps1
./tests/build-cloud.ps1 -Arms right,left -LinkTest
```

Link tests use unusable synthetic credentials and compile the full network path.
Never flash their binaries. To compile your configured source, omit `-LinkTest`.
Build logs and source/binary hashes are recorded under ignored `.build/`.
The scripts compile only; they never flash or deploy.

The cloud command, capture, peer and timing modules are copied from the current
Cloudflare-only piezo transport. Keep fixes to those common modules synchronized
between the two sketch folders. Motor output and status fields are separate.
