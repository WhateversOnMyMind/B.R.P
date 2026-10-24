#include "../TelemetryTiming.h"
#include <cassert>
#include <cstdio>
#include <vector>

int main() {
  using namespace telemetry;
  WindowClock clock;
  clock.begin(0);
  uint32_t count = 7;
  float metres = 1.25f;
  Window window{};
  assert(!clock.take(9999, count, metres, window));
  assert(count == 7 && metres == 1.25f);
  assert(clock.take(10000, count, metres, window));
  assert(window.startMs == 0 && window.endMs == 10000);
  assert(window.count == 7 && window.distanceCm == 125.0f);
  assert(count == 0 && metres == 0);
  // The copied record must not change as the next window accumulates.
  count = 3; metres = 0.5f;
  assert(window.count == 7);
  assert(clock.take(20000, count, metres, window));
  assert(window.count == 3 && window.distanceCm == 50.0f);
  assert(clock.take(30000, count, metres, window));
  assert(window.count == 0 && window.distanceCm == 0);

  // Simulate a separate busy transport; deadlines cannot depend on it.
  for (uint32_t latency : {0U, 3000U, 5000U, 15000U}) {
    clock.begin(0);
    std::vector<uint32_t> ends;
    uint32_t busyUntil = 0;
    for (uint32_t now = 0; now <= 60000; now += 4) {
      if (clock.take(now, count, metres, window)) {
        ends.push_back(window.endMs);
        if (now >= busyUntil) busyUntil = now + latency;
      }
    }
    assert((ends == std::vector<uint32_t>{10000,20000,30000,40000,50000,60000}));
  }
  clock.begin(0);
  count = 10; metres = 1;
  assert(clock.take(35000, count, metres, window));
  assert(window.startMs == 0 && window.endMs == 35000);
  assert(window.lateMs == 25000 && window.missedDeadlines == 2);
  assert(!clock.take(35000, count, metres, window));
  assert(!clock.take(39999, count, metres, window));
  assert(clock.take(40000, count, metres, window));
  assert(window.startMs == 35000 && window.endMs == 40000);

  clock.begin(0xfffffff0U);
  assert(!clock.take(9983, count, metres, window));
  assert(clock.take(9984, count, metres, window));
  assert(window.endMs - window.startMs == 10000);
  assert(sampleElapsedUs(2000, 0xfffff830U) == 4000);
  assert(sampleGapValid(4000));
  assert(!sampleGapValid(0));
  assert(sampleGapValid(100000));
  assert(!sampleGapValid(100001));
  assert(!sampleGapValid(3000000));
  std::puts("PASS: windows, delayed transport, immutable counters, lateness, rollover and sample gaps");
}
