#pragma once
#include <stdint.h>

namespace telemetry {
// Loop-owned accounting of commanded output, not a physical actuator sensor.
// Timed pulses expire independently of loop execution. Durations < 2^31 ms.
class AlertWindow {
 public:
  void continuous(bool on, uint32_t now) {
    account(now);
    active_ = on;
    if (on) seen_ = true; // Retain commands shorter than millis() resolution.
    timed_ = false;
  }
  void stop(uint32_t now) { continuous(false, now); }
  void pulse(uint32_t duration, uint32_t now) {
    account(now);
    active_ = duration > 0;
    if (active_) seen_ = true;
    timed_ = true;
    end_ = now + duration;
  }
  bool take(uint32_t now) {
    account(now);
    const bool result = seen_;
    seen_ = false;
    return result;
  }
 private:
  void account(uint32_t now) {
    if (active_ && now != last_) {
      if (!timed_ || static_cast<int32_t>(end_ - last_) > 0) seen_ = true;
    }
    if (active_ && timed_ && static_cast<int32_t>(now - end_) >= 0) active_ = false;
    last_ = now;
  }
  bool active_ = false, timed_ = false, seen_ = false;
  uint32_t last_ = 0, end_ = 0;
};
}  // namespace telemetry
