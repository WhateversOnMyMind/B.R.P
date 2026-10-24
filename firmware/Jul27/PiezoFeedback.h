#pragma once
#include "FirmwareLogic.h"

float g_feedbackIntensity = 0.0f;
uint32_t g_feedbackPhaseStartMs = 0;
bool g_piezoToneOn = false;
bool g_piezoEverStarted = false;
uint32_t g_piezoPulseStartedMs = 0;
uint16_t g_piezoPulseDurationMs = 0;
uint32_t g_piezoLastWindowIndex = 0;
bool g_piezoHasLastWindow = false;

void piezoStop() {
  g_alertWindow.stop(millis());
  // Timed tone leaves the pin attached to LEDC in ESP32 core 3.3.5. Keep
  // that ownership and set duty to zero; GPIO writes on an LEDC pin fail.
  if (g_piezoEverStarted) ledcWriteTone(PIN_PIEZO, 0);
  else digitalWrite(PIN_PIEZO, LOW);
  g_piezoToneOn = false;
}

void piezoReconcile(uint32_t nowMs) {
  // ESP32 tone(duration) stops in its own task even if this loop is blocked.
  // Reconcile our state when the loop resumes so a new envelope window can
  // start without assuming the old hardware tone is still sounding.
  if (g_piezoToneOn && static_cast<uint32_t>(nowMs - g_piezoPulseStartedMs) >=
                           g_piezoPulseDurationMs) {
    g_piezoToneOn = false;
  }
}

void setFeedbackIntensity(float intensity) {
  g_feedbackIntensity = firmware_logic::clampFeedbackIntensity(intensity);
  const uint32_t nowMs = millis();
  piezoReconcile(nowMs);
  g_feedbackPhaseStartMs = nowMs;
  // An in-flight bounded pulse consumes the new phase's first window. This
  // avoids another burst immediately after it auto-expires.
  g_piezoHasLastWindow = g_piezoToneOn;
  g_piezoLastWindowIndex = 0;
  if (g_feedbackIntensity <= 0.0f) piezoStop();
}

void piezoTick(uint32_t nowMs) {
  piezoReconcile(nowMs);
  const firmware_logic::FeedbackEnvelope envelope =
      firmware_logic::makeFeedbackEnvelope(
          g_feedbackIntensity, g_motorEnabled && !g_recalibrating, peerIsFresh());
  const uint32_t elapsedMs = static_cast<uint32_t>(nowMs - g_feedbackPhaseStartMs);
  if (!firmware_logic::feedbackToneOn(envelope, elapsedMs)) {
    if (g_piezoToneOn || !envelope.active) piezoStop();
    return;
  }
  const uint16_t durationMs = firmware_logic::feedbackPulseDurationMs(
      envelope, elapsedMs, g_piezoToneOn, g_piezoHasLastWindow,
      g_piezoLastWindowIndex);
  if (durationMs == 0) return;
  tone(PIN_PIEZO, PIEZO_HZ, durationMs);
  g_alertWindow.pulse(durationMs, nowMs);
  g_piezoEverStarted = true;
  g_piezoToneOn = true;
  g_piezoPulseStartedMs = nowMs;
  g_piezoPulseDurationMs = durationMs;
  g_piezoLastWindowIndex = elapsedMs / envelope.periodMs;
  g_piezoHasLastWindow = true;
}
