#pragma once

#include <stdint.h>

namespace firmware_logic {

constexpr uint32_t decodeMmc5983Axis(uint8_t msb, uint8_t lsb,
                                     uint8_t packedLowBits,
                                     uint8_t packedShift) {
  return (static_cast<uint32_t>(msb) << 10) |
         (static_cast<uint32_t>(lsb) << 2) |
         ((packedLowBits >> packedShift) & 0x03U);
}

constexpr int32_t centerMmc5983Counts(uint32_t raw) {
  return static_cast<int32_t>(raw) - 131072L;
}

struct FeedbackEnvelope {
  bool active;
  uint16_t periodMs;
  uint16_t onMs;
};

constexpr float clampFeedbackIntensity(float intensity) {
  return intensity < 0.0f ? 0.0f : (intensity > 1.0f ? 1.0f : intensity);
}

constexpr FeedbackEnvelope makeFeedbackEnvelope(float intensity,
                                                 bool feedbackEnabled,
                                                 bool peerFresh) {
  const float bounded = clampFeedbackIntensity(intensity);
  return (!feedbackEnabled || !peerFresh || bounded <= 0.0f)
             ? FeedbackEnvelope{false, 0, 0}
             : FeedbackEnvelope{
                   true,
                   static_cast<uint16_t>(1000.0f - 800.0f * bounded),
                   70};
}

constexpr bool feedbackToneOn(const FeedbackEnvelope& envelope,
                              uint32_t elapsedMs) {
  return envelope.active &&
         (elapsedMs % static_cast<uint32_t>(envelope.periodMs)) < envelope.onMs;
}

// A window can launch at most one bounded pulse. Starting late uses only the
// remaining on time, so loop stalls cannot lengthen or restart that pulse.
constexpr uint16_t feedbackPulseDurationMs(const FeedbackEnvelope& envelope,
                                           uint32_t elapsedMs, bool toneOn,
                                           bool hasLastWindow,
                                           uint32_t lastWindowIndex) {
  if (!envelope.active || toneOn) return 0;
  const uint32_t windowIndex = elapsedMs / envelope.periodMs;
  const uint32_t phaseMs = elapsedMs % envelope.periodMs;
  if ((hasLastWindow && windowIndex == lastWindowIndex) ||
      phaseMs >= envelope.onMs) return 0;
  return static_cast<uint16_t>(envelope.onMs - phaseMs);
}

constexpr bool mmcMeasurementTimedOut(uint32_t nowMs, uint32_t startedMs,
                                      uint16_t deadlineMs) {
  return static_cast<uint32_t>(nowMs - startedMs) >= deadlineMs;
}

constexpr uint32_t kMagSampleMaxAgeMs = 250;

constexpr bool magSampleAvailable(bool driverReady, uint32_t sequence,
                                  uint32_t nowMs, uint32_t capturedMs) {
  return driverReady && sequence != 0 &&
         static_cast<uint32_t>(nowMs - capturedMs) <= kMagSampleMaxAgeMs;
}

}  // namespace firmware_logic
