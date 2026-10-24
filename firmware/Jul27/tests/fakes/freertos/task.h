#pragma once
#include "FreeRTOS.h"
inline void (*fakeTask)(void*) = nullptr;
inline bool fakeTaskFailure = false;
inline int xTaskCreatePinnedToCore(void (*task)(void*), const char*, uint32_t,
                                  void*, int, void*, BaseType_t) {
  if (fakeTaskFailure) return 0;
  fakeTask = task;
  return pdPASS;
}
