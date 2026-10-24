#pragma once
#include <stdint.h>

namespace telemetry {
constexpr uint32_t kWindowMs = 10000;
constexpr uint32_t kMaxSampleGapUs = 100000;

struct Window {
  uint32_t startMs, endMs, lateMs, missedDeadlines, count;
  float distanceCm;
};

// Owned exclusively by the measurement loop. Transport never advances time.
class WindowClock {
 public:
  void begin(uint32_t now) { start_ = now; deadline_ = now + kWindowMs; }
  bool take(uint32_t now, uint32_t& count, float& metres, Window& out) {
    if (static_cast<int32_t>(now - deadline_) < 0) return false;
    const uint32_t late = now - deadline_;
    out = {start_, now, late, late / kWindowMs, count, metres * 100.0f};
    count = 0;
    metres = 0;
    start_ = now;
    // One extended record after a stall, never fabricated catch-up windows.
    deadline_ += (late / kWindowMs + 1) * kWindowMs;
    return true;
  }
 private:
  uint32_t start_ = 0, deadline_ = 0;
};

constexpr uint32_t sampleElapsedUs(uint32_t now, uint32_t previous) {
  return now - previous;
}
constexpr bool sampleGapValid(uint32_t elapsed) {
  return elapsed > 0 && elapsed <= kMaxSampleGapUs;
}
}  // namespace telemetry
