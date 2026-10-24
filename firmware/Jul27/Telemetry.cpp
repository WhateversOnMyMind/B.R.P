#include "Telemetry.h"
#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>
#include <freertos/task.h>

namespace telemetry {
namespace {
QueueHandle_t jobs = nullptr;
const char* url = nullptr;
portMUX_TYPE statusMux = portMUX_INITIALIZER_UNLOCKED;
Status current = {};

void uploadTask(void*) {
  Job job;
  for (;;) {
    if (xQueueReceive(jobs, &job, portMAX_DELAY) != pdTRUE) continue;
    const uint32_t started = millis();
    portENTER_CRITICAL(&statusMux);
    current.busy = true;
    current.lastSequence = job.sequence;
    current.lastStartMs = started;
    portEXIT_CRITICAL(&statusMux);

    // Preserve receiver schema. Timing/sequence metadata stays in diagnostics
    // until the Apps Script receiver explicitly supports it.
    String json;
    if (job.kind == Kind::Toggle) {
      json = String("{\"event\":\"motor_toggle\",\"state\":\"") +
             (job.enabled ? "on" : "off") + "\",\"ts\":" +
             String(job.epochSeconds) + "}";
    } else {
      json = String("{\"arm\":\"") + job.arm + "\",\"count\":" +
             String(job.window.count) + ",\"distance\":" +
             String(job.window.distanceCm, 2) + ",\"alerted\":" +
             (job.alerted ? "true" : "false") + "}";
    }

    int code = -1000;  // Local offline/begin failure, distinct from HTTP codes.
    if (WiFi.status() == WL_CONNECTED) {
      HTTPClient http;
      http.setConnectTimeout(5000);
      http.setTimeout(5000);
      // No automatic POST redirects/retries: receiver may already have written
      // the row. Report 3xx separately rather than risk duplicate trial data.
      http.setFollowRedirects(HTTPC_DISABLE_FOLLOW_REDIRECTS);
      if (http.begin(url)) {
        http.addHeader("Content-Type", "application/json");
        code = http.POST(json);
      }
      http.end();
    }
    const uint32_t ended = millis();
    portENTER_CRITICAL(&statusMux);
    current.busy = false;
    current.lastEndMs = ended;
    current.lastDurationMs = ended - started;
    current.lastHttpCode = code;
    if (code >= 200 && code < 300) ++current.succeeded;
    else if (code >= 300 && code < 400) ++current.unconfirmed;
    else ++current.failed;
    portEXIT_CRITICAL(&statusMux);
    Serial.printf("[upload] boot=%lu seq=%lu kind=%s captured=%lu start=%lu end=%lu duration=%lu code=%d\n",
                  (unsigned long)job.bootId, (unsigned long)job.sequence,
                  job.kind == Kind::Window ? "window" : "toggle",
                  (unsigned long)job.capturedMs, (unsigned long)started,
                  (unsigned long)ended, (unsigned long)(ended - started), code);
  }
}
}  // namespace

bool begin(const char* endpoint) {
  if (jobs != nullptr) return true;
  url = endpoint;
  jobs = xQueueCreate(12, sizeof(Job));
  if (jobs == nullptr) return false;
  // On the dual-core S3 keep blocking TLS/HTTP away from the Arduino loop.
#if CONFIG_FREERTOS_UNICORE
  const BaseType_t uploadCore = 0;
#else
  const BaseType_t uploadCore = (ARDUINO_RUNNING_CORE == 0) ? 1 : 0;
#endif
  if (xTaskCreatePinnedToCore(uploadTask, "sheets-upload", 8192, nullptr, 1,
                              nullptr, uploadCore) != pdPASS) {
    vQueueDelete(jobs);
    jobs = nullptr;
    return false;
  }
  portENTER_CRITICAL(&statusMux);
  current.ready = true;
  portEXIT_CRITICAL(&statusMux);
  return true;
}

bool enqueue(const Job& job) {
  if (jobs != nullptr && xQueueSend(jobs, &job, 0) == pdTRUE) return true;
  portENTER_CRITICAL(&statusMux);
  ++current.dropped;
  portEXIT_CRITICAL(&statusMux);
  return false;
}

Status status() {
  portENTER_CRITICAL(&statusMux);
  Status result = current;
  portEXIT_CRITICAL(&statusMux);
  result.queued = jobs == nullptr ? 0 : uxQueueMessagesWaiting(jobs);
  return result;
}
}  // namespace telemetry
