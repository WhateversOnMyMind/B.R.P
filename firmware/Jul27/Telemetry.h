#pragma once
#include "TelemetryTiming.h"

namespace telemetry {
enum class Kind : uint8_t { Window, Toggle };
struct Job {
  Kind kind;
  char arm;
  bool enabled;
  bool alerted;
  uint32_t bootId, sequence, capturedMs, epochSeconds;
  Window window;
};
struct Status {
  bool ready, busy;
  uint32_t queued, dropped, failed, unconfirmed, succeeded;
  uint32_t lastSequence, lastStartMs, lastEndMs, lastDurationMs;
  int lastHttpCode;
};

// The endpoint must remain alive for the lifetime of the worker.
bool begin(const char* endpoint);
bool enqueue(const Job& job);  // Copies by value, never waits for space.
Status status();
}  // namespace telemetry
