#include <cassert>
#include <cstdint>
#include <cstdio>
#include "../AlertWindow.h"

constexpr int PIN_VIBE = 14;
uint32_t nowMs = 0;
bool g_motorEnabled = true, g_recalibrating = false, fresh = true;
int hardwarePwm = -1;
telemetry::AlertWindow g_alertWindow;
uint32_t millis() { return nowMs; }
bool peerIsFresh() { return fresh; }
void analogWrite(int pin, int pwm) { assert(pin == 14); hardwarePwm = pwm; }
#include "../MotorFeedback.h"

int main() {
  setVibrationOutput(127);
  assert(hardwarePwm == 127 && g_commandedPwm == 127);
  nowMs = 10000;
  assert(g_alertWindow.take(nowMs));
  nowMs = 20000;
  assert(g_alertWindow.take(nowMs)); // Continuous vibration spans both windows.
  nowMs = 20001;
  g_motorEnabled = false;
  setVibrationOutput(200);
  assert(hardwarePwm == 0 && g_commandedPwm == 0);
  assert(g_alertWindow.take(nowMs)); // On until the disable command.
  nowMs = 30000;
  assert(!g_alertWindow.take(nowMs));
  g_motorEnabled = true; fresh = false;
  setVibrationOutput(255); assert(hardwarePwm == 0);
  fresh = true; g_recalibrating = true;
  setVibrationOutput(255); assert(hardwarePwm == 0);
  g_recalibrating = false;
  setVibrationOutput(-1); assert(hardwarePwm == 0 && g_commandedPwm == 0);
  setVibrationOutput(300); assert(hardwarePwm == 255 && g_commandedPwm == 255);
  setVibrationOutput(0); assert(hardwarePwm == 0);
  puts("PASS: GPIO 14 motor PWM, bounds, disable, peer loss, calibration and continuous alert windows");
}
