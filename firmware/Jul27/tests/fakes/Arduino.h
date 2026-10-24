#pragma once
#include <cstdint>
#include <cstdio>
#include <iomanip>
#include <sstream>
#include <string>

inline uint32_t fakeNow = 0;
inline uint32_t millis() { return fakeNow; }
using portMUX_TYPE = int;
#define portMUX_INITIALIZER_UNLOCKED 0
#define portENTER_CRITICAL(mux) ((void)(mux))
#define portEXIT_CRITICAL(mux) ((void)(mux))
#define CONFIG_FREERTOS_UNICORE 0
#define ARDUINO_RUNNING_CORE 1
class String {
 public:
  std::string text;
  String() = default;
  String(const char* s) : text(s) {}
  String(const std::string& s) : text(s) {}
  String(char c) : text(1, c) {}
  String(uint32_t n) : text(std::to_string(n)) {}
  String(float n, int digits) {
    std::ostringstream s; s << std::fixed << std::setprecision(digits) << n;
    text = s.str();
  }
  friend String operator+(const String& a, const String& b) { return a.text + b.text; }
};
struct FakeSerial { template<class... T> void printf(const char*, T...) {} };
inline FakeSerial Serial;
