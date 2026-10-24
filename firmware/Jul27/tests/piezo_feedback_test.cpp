#include <cassert>
#include <cstdint>
#include <cstdio>
#include "../AlertWindow.h"

constexpr int PIN_PIEZO=14, PIEZO_HZ=4000, LOW=0;
uint32_t nowMs=0;
bool g_motorEnabled=true, g_recalibrating=false, fresh=true;
int starts=0, stops=0;
uint16_t lastDuration=0;
telemetry::AlertWindow g_alertWindow;
uint32_t millis() { return nowMs; }
bool peerIsFresh() { return fresh; }
void digitalWrite(int pin,int level) { assert(pin==14&&level==0); ++stops; }
void ledcWriteTone(int pin,int hz) { assert(pin==14&&hz==0); ++stops; }
void tone(int pin,int hz,uint16_t duration) {
  assert(pin==14&&hz==4000); ++starts; lastDuration=duration;
}
#include "../PiezoFeedback.h"

int main() {
  setFeedbackIntensity(0.5f);
  piezoTick(nowMs);
  assert(starts==1 && lastDuration==70);
  nowMs=10; piezoTick(nowMs); assert(starts==1);
  nowMs=70; piezoTick(nowMs); assert(!g_piezoToneOn);
  nowMs=600; piezoTick(nowMs); assert(starts==2 && lastDuration==70);
  g_motorEnabled=false; piezoTick(nowMs); assert(!g_piezoToneOn && stops>0);
  g_motorEnabled=true;
  nowMs=1200; fresh=false; piezoTick(nowMs); assert(starts==2);
  fresh=true; g_recalibrating=true; piezoTick(nowMs);
  assert(starts==2 && !g_piezoToneOn); // Calibration must suppress the copied envelope.
  g_recalibrating=false;
  nowMs=1810; piezoTick(nowMs); assert(starts==3 && lastDuration==60);
  nowMs=1875; piezoTick(nowMs); assert(starts==3 && !g_piezoToneOn);
  assert(g_alertWindow.take(nowMs));
  setFeedbackIntensity(0); assert(!g_piezoToneOn);
  nowMs=2400; piezoTick(nowMs); assert(starts==3);
  assert(!g_alertWindow.take(nowMs));
  nowMs=UINT32_MAX-10; setFeedbackIntensity(1); piezoTick(nowMs);
  assert(starts==4 && lastDuration==70);
  nowMs=59; piezoTick(nowMs); assert(!g_piezoToneOn);
  nowMs=189; piezoTick(nowMs); assert(starts==5 && lastDuration==70);
  puts("PASS: piezo cadence, bounded pulses, disable, peer loss, calibration, alert windows and rollover");
}
