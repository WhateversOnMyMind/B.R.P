/*
 * Arm-swing tracker + ESP-NOW balance feedback
 * ONE IMU per MCU (ESP32-S3-MINI-1 + one ICM-42688-P) — Composite Board rev C
 *
 * Two independent boards. Flash this SAME sketch to BOTH; change only the
 * ARM toggle below. Each board:
 *   - tracks its own arm's swings,
 *   - reports its latest 10-second measurement window through Cloudflare,
 *   - sends its recent swing window to its encrypted ESP-NOW peer,
 *   - compares the two arms and drives ITS OWN vibration motor when its arm lags.
 *
 * Pins from Composite Board rev C:
 *   SPI   MISO=IO8  MOSI=IO9  SCLK=IO10  CS=IO11        (IMU U3)
 *   MOTOR driver input = IO14 (PWM 0-255; populated motor driver required)
 *
 * ESP-NOW note: both boards join the same AP, so they sit on the same WiFi
 * channel automatically and ESP-NOW + HTTP coexist. Init ESP-NOW AFTER WiFi.
 */

// ─────────── pick this board's arm ───────────
//#define ARM_IS_LEFT          // <-- comment out on the RIGHT board
// ─────────────────────────────────────────────

#include <Arduino.h>
#include <SPI.h>
#include <math.h>
#include <time.h>
#include <WiFi.h>
#include <esp_now.h>
#include <esp_system.h>
#include "TelemetryTiming.h"
#include "AlertWindow.h"
#include "CloudControl.h"
#include "CloudSettings.h"
#include "PeerProtocol.h"
#include "PeerAuthentication.h"
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>
telemetry::AlertWindow g_alertWindow;

#ifdef ARM_IS_LEFT
  static const char ARM_CHAR = 'L';
#else
  static const char ARM_CHAR = 'R';
#endif
static const bool I_AM_LEFT = (ARM_CHAR == 'L');

// Explicit declarations for the sensing-loop cloud/capture adapters.
void cloudActionsTick();
void cloudPublish();
void rawLogTick();
void setVibrationOutput(int pwm);

/* ── WiFi ── */
#if __has_include("WifiConfig.h")
#include "WifiConfig.h"
#else
#define WIFI_SSID ""
#define WIFI_PASSWORD ""
#endif
const char* ssid = WIFI_SSID;
const char* password = WIFI_PASSWORD;

/* ── SPI pin map (single IMU) ── */
static const int PIN_MISO = 8;
static const int PIN_MOSI = 9;
static const int PIN_SCLK = 10;
static const int PIN_CS   = 11;

/* Motor driver input, matching the original motor hardware. */
#define PIN_VIBE 14

/* ── ICM-42688-P registers ── */
#define REG_DEVICE_CONFIG   0x11
#define REG_TEMP_DATA1      0x1D
#define REG_PWR_MGMT0       0x4E
#define REG_GYRO_CONFIG0    0x4F
#define REG_ACCEL_CONFIG0   0x50
#define REG_WHO_AM_I        0x75
#define WHO_AM_I_EXPECTED   0x47

static const float GYRO_LSB_PER_DPS = 16.4f;    // ±2000 dps
static const float ACCEL_LSB_PER_G  = 2048.0f;  // ±16 g
static const float DEG2RAD = 0.0174532925f;
static const float G2MS2   = 9.80665f;

static uint32_t spiHz = 8000000;
SPIClass spi(FSPI);

/* ── sampling & calibration ── */
#define SAMPLE_RATE_HZ  250
#define CALIB_TIME_MS   2000

/* ── swing thresholds ── */
#define GYRO_THRESH_FWD      0.4f
#define GYRO_THRESH_BACK     0.4f
#define RADIUS_DEFAULT       0.30f
#define ACCEL_MAG_THRESH_DELTA 2.0f
#define ACCEL_IDLE_TOL       1.0f     // m/s^2 tolerance around 1g for the bias-tracker idle gate
#define SWING_MAX_MS         1200
#define WY_IDLE              0.12f
#define END_ZERO_CROSS_MS    180
#define BIAS_ADAPT_ALPHA     0.0008f

/* ── window timing ── */
#define FB_WINDOW_MS      5000      // haptic-feedback comparison window
#define FB_PEER_TIMEOUT   (FB_WINDOW_MS + 1000)      // peer silent longer than this -> motor off

/* ── feedback shaping ──
 * delta = 0.5 - myShare  (>0 means THIS arm is lagging).
 * Buzz starts past the dead zone and ramps to full at maximum imbalance.
 * Raise FB_DEAD_ZONE to ~0.20 to reproduce the old 0.30 hard gate. */
#define FB_DEAD_ZONE      0.055f

struct Sample { float ax, ay, az, gx, gy, gz, tempC; };

Sample g_lastSample;   // most recent IMU reading, shared so RawLog.ino doesn't need its own SPI read

/* ── this board's arm state ── */
float    g_bias = 0.0f;             // rad/s
float    g_radius = RADIUS_DEFAULT;
bool     g_inSwing = false;
int      g_dir = 0;
float    g_angle = 0.0f;
float    g_startAngle = 0.0f;
uint32_t g_swingCount = 0;          // 10-second measurement window
float    g_swingDistanceSum = 0.0f; // measurement window (m)
uint32_t g_fbCount = 0;             // feedback window
float    g_fbDist  = 0.0f;          // feedback window (m)
uint32_t g_lastSwingTime = 0;
bool g_motorEnabled = true;   // LEFT owns explicit cloud settings; RIGHT adopts paired revision
float g_feedbackDeadZone = FB_DEAD_ZONE;
uint32_t g_settingsRevision = 0;

bool g_recalibrating = false;
uint32_t g_calibrationStart = 0, g_calibrationSamples = 0;
float g_calibrationSum = 0;
cloud::Command g_calibrationCommand;
cloud::Guard g_commandGuard;
bool g_commandExecuting = false;
uint32_t g_swingStartMs = 0;


uint32_t lastMicros = 0;
telemetry::WindowClock g_windowClock;
telemetry::Window g_lastWindow = {};
uint32_t g_bootId = 0, g_windowSequence = 0;
bool g_lastWindowAlerted = false;
uint32_t g_maxSampleGapUs = 0, g_sampleGapCount = 0;
unsigned long lastFbTime   = 0;

/* ── ESP-NOW peer exchange ── */
using PeerMsg = cloud::PeerPacket;
struct PeerReceived { PeerMsg packet; uint32_t receivedMs; };
QueueHandle_t g_peerQueue = nullptr;
cloud::PeerGuard g_peerGuard;
uint32_t g_peerSequence = 0;
bool g_peerReady = false;
uint32_t peerCount = 0;
float peerDist = 0.0f;
uint32_t peerRxMs = 0;
char peerArm = '?';

/* ── SPI transport ── */
uint8_t regRead(uint8_t reg) {
  spi.beginTransaction(SPISettings(spiHz, MSBFIRST, SPI_MODE3));
  digitalWrite(PIN_CS, LOW);
  spi.transfer(reg | 0x80);
  uint8_t v = spi.transfer(0x00);
  digitalWrite(PIN_CS, HIGH);
  spi.endTransaction();
  return v;
}
void regReadBurst(uint8_t reg, uint8_t* buf, size_t n) {
  spi.beginTransaction(SPISettings(spiHz, MSBFIRST, SPI_MODE3));
  digitalWrite(PIN_CS, LOW);
  spi.transfer(reg | 0x80);
  for (size_t i = 0; i < n; i++) buf[i] = spi.transfer(0x00);
  digitalWrite(PIN_CS, HIGH);
  spi.endTransaction();
}
void regWrite(uint8_t reg, uint8_t val) {
  spi.beginTransaction(SPISettings(spiHz, MSBFIRST, SPI_MODE3));
  digitalWrite(PIN_CS, LOW);
  spi.transfer(reg & 0x7F);
  spi.transfer(val);
  digitalWrite(PIN_CS, HIGH);
  spi.endTransaction();
  delayMicroseconds(200);
}

Sample readSample() {
  uint8_t r[14];
  regReadBurst(REG_TEMP_DATA1, r, 14);
  auto i16 = [](uint8_t hi, uint8_t lo){ return (int16_t)((hi << 8) | lo); };
  Sample s;
  s.tempC = i16(r[0],  r[1])  / 132.48f + 25.0f;
  s.ax    = i16(r[2],  r[3])  / ACCEL_LSB_PER_G;
  s.ay    = i16(r[4],  r[5])  / ACCEL_LSB_PER_G;
  s.az    = i16(r[6],  r[7])  / ACCEL_LSB_PER_G;
  s.gx    = i16(r[8],  r[9])  / GYRO_LSB_PER_DPS;
  s.gy    = i16(r[10], r[11]) / GYRO_LSB_PER_DPS;
  s.gz    = i16(r[12], r[13]) / GYRO_LSB_PER_DPS;
  return s;
}

bool initIMU() {
  regWrite(REG_DEVICE_CONFIG, 0x01); delay(5);
  regWrite(REG_GYRO_CONFIG0,  0x06);
  regWrite(REG_ACCEL_CONFIG0, 0x06);
  regWrite(REG_PWR_MGMT0,     0x0F); delay(100);
  uint8_t who = regRead(REG_WHO_AM_I);
  Serial.printf("IMU %c  WHO_AM_I = 0x%02X\n", ARM_CHAR, who);
  return who == WHO_AM_I_EXPECTED;
}

void calibrateGyro() {
  Serial.print(F("Calibrating ")); Serial.println(ARM_CHAR);
  delay(400);
  uint32_t t0 = millis();
  float sum = 0; uint32_t n = 0;
  while (millis() - t0 < CALIB_TIME_MS) {
    sum += readSample().gy * DEG2RAD;   // <-- swing axis (change if not gy)
    ++n; delay(4);
  }
  g_bias = sum / n;
  g_angle = 0; g_dir = 0; g_inSwing = false; g_swingCount = 0;
  Serial.print(ARM_CHAR); Serial.print(F(" bias = "));
  Serial.println(g_bias, 6);
}

void calibrationTick(const Sample& sample) {
  if(!g_recalibrating) return;
  const uint32_t elapsed=millis()-g_calibrationStart;
  if(elapsed<400) return;
  if(elapsed<400+CALIB_TIME_MS) {
    g_calibrationSum+=sample.gy*DEG2RAD; ++g_calibrationSamples; return;
  }
  const bool applied=g_calibrationSamples>0;
  if(applied) g_bias=g_calibrationSum/g_calibrationSamples;
  g_recalibrating=false; g_commandExecuting=false;
  g_inSwing=false; g_dir=0;
  g_commandGuard.remember(g_calibrationCommand,applied);
  cloud::acknowledge(g_calibrationCommand,applied,applied?"calibration completed":"no samples");
}

void printSwing(float endAngle) {
  uint32_t now = millis();
  if (now - g_lastSwingTime < 400) {
    // debounce quick repeats, but still end/reset below
  } else {
    float dTheta = endAngle - g_startAngle;
    ++g_swingCount;
    ++g_fbCount;
    float arcLen = fabsf(dTheta) * g_radius;
    g_swingDistanceSum += arcLen;
    g_fbDist           += arcLen;
    Serial.print(F("Swing ")); Serial.print(ARM_CHAR);
    Serial.print(F(" #")); Serial.print(g_swingCount);
    Serial.print(F(" | Angle: ")); Serial.print(fabsf(dTheta) * 57.29578f, 1);
    Serial.print(F(" deg | Length: ")); Serial.print(arcLen * 100.0f, 1);
    Serial.println(F(" cm"));
    g_lastSwingTime = now;
  }
  g_inSwing = false;
  g_dir = 0;
}

void updateArm(float dt) {
  Sample s = readSample();
  g_lastSample = s;
  if(g_recalibrating) { calibrationTick(s); return; }
  // Keep raw telemetry fresh, but never extrapolate across missing samples.
  if (dt <= 0.0f) { g_inSwing = false; g_dir = 0; return; }

  // ── SWING AXIS: original used Y. If not Y on this mounting, change s.gy
  //    -> s.gx or s.gz here AND in calibrateGyro(). ──
  float wy_raw = s.gy * DEG2RAD;               // rad/s
  float wy = wy_raw - g_bias;
  g_angle += wy * dt;

  float ax = s.ax * G2MS2, ay = s.ay * G2MS2, az = s.az * G2MS2;
  float aMag = sqrtf(ax*ax + ay*ay + az*az);   // m/s^2
  bool accelTrigger = fabsf(aMag - 9.8f) > ACCEL_MAG_THRESH_DELTA;

  if (!g_inSwing) {
    if (accelTrigger) {
      if (wy > GYRO_THRESH_FWD) {
        g_inSwing = true; g_dir = +1; g_startAngle = g_angle; g_swingStartMs = millis();
      } else if (wy < -GYRO_THRESH_BACK) {
        g_inSwing = true; g_dir = -1; g_startAngle = g_angle; g_swingStartMs = millis();
      }
    }
  } else {
    bool crossed = (g_dir == +1 && wy < -GYRO_THRESH_BACK) ||
                   (g_dir == -1 && wy >  GYRO_THRESH_FWD);
    uint32_t elapsed = millis() - g_swingStartMs;
    bool zeroLike = (fabsf(wy) < WY_IDLE) && (elapsed > END_ZERO_CROSS_MS);
    bool timeout  = elapsed > SWING_MAX_MS;
    if (crossed || zeroLike || timeout) printSwing(g_angle);
  }

  if (fabsf(wy) < WY_IDLE && fabsf(aMag - 9.8f) < ACCEL_IDLE_TOL)
    g_bias = (1.0f - BIAS_ADAPT_ALPHA) * g_bias + BIAS_ADAPT_ALPHA * wy_raw;
}

/* ── snapshot THIS arm's window for the existing cloud status exchange ── */
void closeMeasurementWindow() {
  const uint32_t now = millis();
  if (!g_windowClock.take(now, g_swingCount, g_swingDistanceSum, g_lastWindow)) return;
  ++g_windowSequence;
  g_lastWindowAlerted = g_alertWindow.take(now);
  Serial.printf("[window] boot=%lu seq=%lu start=%lu end=%lu late=%lu missed=%lu count=%lu distanceCm=%.2f alerted=%d maxGapUs=%lu gaps=%lu\n",
                (unsigned long)g_bootId, (unsigned long)g_windowSequence,
                (unsigned long)g_lastWindow.startMs, (unsigned long)g_lastWindow.endMs,
                (unsigned long)g_lastWindow.lateMs, (unsigned long)g_lastWindow.missedDeadlines,
                (unsigned long)g_lastWindow.count, g_lastWindow.distanceCm, g_lastWindowAlerted,
                (unsigned long)g_maxSampleGapUs, (unsigned long)g_sampleGapCount);
}

/* ── ESP-NOW receive: store the OTHER arm's latest window ── */
#if ESP_ARDUINO_VERSION_MAJOR >= 3
void onRecv(const esp_now_recv_info_t* info, const uint8_t* data, int len) {
  const uint8_t* source=info?info->src_addr:nullptr;
#else
void onRecv(const uint8_t* source, const uint8_t* data, int len) {
#endif
  if (!g_peerQueue || len != sizeof(PeerMsg)) return;
  PeerMsg m; memcpy(&m, data, sizeof(m));
  if(!cloud::authenticPeer(m)) return;
  if(!g_peerGuard.accept(m,source,cloud::peerMac,CLOUD_PAIR_ID,ARM_CHAR)) return;
  PeerReceived event{m,millis()}; xQueueOverwrite(g_peerQueue,&event);
}

void receivePeer() {
  PeerReceived event;
  if(!g_peerQueue || xQueueReceive(g_peerQueue,&event,0)!=pdTRUE) return;
  const auto& m=event.packet;
  peerArm=m.arm; peerCount=m.count; peerDist=m.distance; peerRxMs=event.receivedMs;
  if(!I_AM_LEFT && m.settingsRevision>=g_settingsRevision) {
    g_motorEnabled=m.motorEnabled; g_feedbackDeadZone=m.sensitivity;
    g_settingsRevision=m.settingsRevision;
    if(!g_motorEnabled) setVibrationOutput(0);
  }
}

void initEspNow() {
  if(!cloud::pairingConfigured()) { Serial.println(F("Peer unconfigured; feedback unavailable")); return; }
  g_peerQueue=xQueueCreate(1,sizeof(PeerReceived));
  if(!g_peerQueue) return;
  WiFi.setSleep(false);                  // keep radio awake for reliable ESP-NOW
  if (esp_now_init() != ESP_OK) { Serial.println(F("ESP-NOW init failed")); return; }
  if(esp_now_set_pmk(cloud::pmk)!=ESP_OK) return;
  esp_now_register_recv_cb(onRecv);

  esp_now_peer_info_t p = {};
  memcpy(p.peer_addr, cloud::peerMac, 6);
  p.channel = 0;                         // 0 = use current STA channel
  p.ifidx   = WIFI_IF_STA;
  p.encrypt = true;
  memcpy(p.lmk,cloud::lmk,16);
  if (esp_now_add_peer(&p) != ESP_OK) { Serial.println(F("ESP-NOW add peer failed")); return; }
  g_peerReady=true;
  Serial.printf("ESP-NOW ready on channel %d\n", WiFi.channel());
}

/* ── check if the peer's data is fresh (used for cross-tab peer-state tracking) ── */
bool peerIsFresh() {
  return (peerArm != '?') && (millis() - peerRxMs < FB_PEER_TIMEOUT);
}

#include "MotorFeedback.h"

/* Compare arms every five seconds and update vibration strength. */
void feedbackTick() {
  uint32_t myC = g_fbCount;  float myD = g_fbDist;
  g_fbCount = 0; g_fbDist = 0;

  // broadcast my just-finished window
  PeerMsg m; m.arm = ARM_CHAR; m.count = myC; m.distance = myD;
  m.motorEnabled = g_motorEnabled; m.sensitivity = g_feedbackDeadZone;
  m.pair=CLOUD_PAIR_ID; m.boot=g_bootId; m.sequence=++g_peerSequence;
  m.settingsRevision=g_settingsRevision;
  if(g_peerReady && m.sequence && cloud::signPeer(m)) esp_now_send(cloud::peerMac, (uint8_t*)&m, sizeof(m));

  // need a live peer to compute balance
  bool peerFresh = peerIsFresh();
  if (!peerFresh || g_recalibrating) { setVibrationOutput(0); return; }

  uint32_t pC = peerCount; float pD = peerDist;

  uint32_t lc, rc; float ld, rd;
  if (I_AM_LEFT) { lc = myC; ld = myD; rc = pC; rd = pD; }
  else           { rc = myC; rd = myD; lc = pC; ld = pD; }

  if ((lc + rc) == 0 || (ld + rd) <= 0.0f) { setVibrationOutput(0); return; }

  float countFracL = (float)lc / (float)(lc + rc);
  float distFracL  = ld / (ld + rd);
  float leftShare  = (countFracL + distFracL) / 2.0f;
  float myShare    = I_AM_LEFT ? leftShare : (1.0f - leftShare);

  float delta = 0.5f - myShare;              // >0 => my arm is lagging
  if (delta <= g_feedbackDeadZone) { setVibrationOutput(0); return; }  // balanced or ahead

  float intensity = (delta - g_feedbackDeadZone) / (0.5f - g_feedbackDeadZone);
  if (intensity < 0) intensity = 0;
  if (intensity > 1) intensity = 1;
  int pwm = (int)(255.0f * intensity);

  Serial.printf("[%c] leftShare=%.2f myShare=%.2f -> motor PWM %d\n",
                ARM_CHAR, leftShare, myShare, pwm);
  setVibrationOutput(g_motorEnabled ? pwm : 0);
}

void setup() {
  pinMode(PIN_VIBE, OUTPUT);
  digitalWrite(PIN_VIBE, LOW);
  Serial.begin(115200);
  delay(500);

  pinMode(PIN_CS, OUTPUT); digitalWrite(PIN_CS, HIGH);
  spi.begin(PIN_SCLK, PIN_MISO, PIN_MOSI, -1);
  delay(50);

  if (!initIMU()) { Serial.println(F("IMU not found!")); while (1) delay(10); }


  WiFi.begin(ssid, password);
  Serial.print("Connecting to WiFi");
  const uint32_t wifiStarted=millis();
  while (WiFi.status() != WL_CONNECTED && millis()-wifiStarted<15000) { delay(500); Serial.print("."); }
  Serial.println(WiFi.status()==WL_CONNECTED?"\nWiFi connected!":"\nWiFi offline; sensing continues");
  Serial.print(F("IP address: ")); Serial.println(WiFi.localIP());

  configTime(0, 0, "pool.ntp.org", "time.nist.gov");   // UTC time for TLS certificate validation
  Serial.print(F("Syncing time"));
  uint32_t ntpStart = millis();
  while (time(nullptr) < 1000000000UL && millis() - ntpStart < 5000) {
    delay(100);
    Serial.print(".");
  }
  Serial.println();

  initEspNow();                  // after WiFi so we inherit the AP's channel
  if(!capture::begin()) Serial.println(F("Raw capture unavailable (mount/worker); no auto-format"));

  // Wait for the IMU to thermally stabilize before locking in the bias
  // calibration -- self-heating right after power-on can shift gyro bias
  // for the first tens of seconds. This reuses time already spent on the
  // above setup steps rather than asking the wearer to hold still longer.
  Serial.print(F("Waiting for IMU warm-up"));
  float lastTempC = readSample().tempC;
  uint32_t warmupStart = millis();
  uint32_t stableSinceMs = millis();
  while (millis() - warmupStart < 45000) {
    delay(1000);
    float tempC = readSample().tempC;
    if (fabsf(tempC - lastTempC) > 0.2f) {
      stableSinceMs = millis();
    }
    lastTempC = tempC;
    Serial.print(".");
    if (millis() - stableSinceMs > 5000) break;   // stable for 5s straight
  }
  Serial.println();

  calibrateGyro();               // keep the arm STILL here

  setVibrationOutput(0);

  g_bootId = esp_random();
  if (!cloud::begin()) Serial.println(F("Cloud unconfigured/unavailable; local HTTP disabled"));
  g_windowClock.begin(millis());
  lastMicros = micros();
  lastFbTime   = millis();
  g_lastSwingTime = 0; g_swingStartMs = 0;
}

void loop() {
  // Close the previous window before this sample can add another swing.
  closeMeasurementWindow();
  const uint32_t now = micros();
  const uint32_t elapsedUs = telemetry::sampleElapsedUs(now, lastMicros);
  lastMicros = now;
  if (elapsedUs > g_maxSampleGapUs) g_maxSampleGapUs = elapsedUs;
  const bool validGap = telemetry::sampleGapValid(elapsedUs);
  if (!validGap) ++g_sampleGapCount;
  const float dt = validGap ? elapsedUs * 1e-6f : 0.0f;

  updateArm(dt);
  receivePeer();
  cloudActionsTick();
  rawLogTick();                  // capture a raw sample row if a log session is active
  if(!peerIsFresh() || !g_motorEnabled || g_recalibrating) {
    if(g_commandedPwm > 0) setVibrationOutput(0);
  }

  if (millis() - lastFbTime >= FB_WINDOW_MS) {
    feedbackTick();
    lastFbTime = millis();
  }

  cloudPublish();
  delayMicroseconds(1000000 / SAMPLE_RATE_HZ - 200);
}
