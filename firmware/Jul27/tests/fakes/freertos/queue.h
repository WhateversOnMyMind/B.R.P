#pragma once
#include "FreeRTOS.h"
#include <cassert>
#include <cstring>
#include <deque>
#include <vector>
struct Queue { size_t capacity, itemSize; std::deque<std::vector<char>> items; };
using QueueHandle_t = Queue*;
inline bool fakeQueueFailure = false;
struct WorkerIdle {};
inline QueueHandle_t xQueueCreate(size_t capacity, size_t size) {
  return fakeQueueFailure ? nullptr : new Queue{capacity, size, {}};
}
inline int xQueueSend(QueueHandle_t q, const void* item, uint32_t wait) {
  assert(wait == 0);  // Firmware must never block the producer.
  if (q->items.size() == q->capacity) return 0;
  q->items.emplace_back(static_cast<const char*>(item), static_cast<const char*>(item) + q->itemSize);
  return pdTRUE;
}
inline int xQueueReceive(QueueHandle_t q, void* item, uint32_t wait) {
  assert(wait == portMAX_DELAY);
  if (q->items.empty()) throw WorkerIdle{};  // Stop an otherwise infinite worker in this test.
  std::memcpy(item, q->items.front().data(), q->itemSize);
  q->items.pop_front();
  return pdTRUE;
}
inline void vQueueDelete(QueueHandle_t q) { delete q; }
inline uint32_t uxQueueMessagesWaiting(QueueHandle_t q) { return q->items.size(); }
