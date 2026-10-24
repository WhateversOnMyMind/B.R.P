#pragma once
#include "Arduino.h"
#include <cassert>
#include <functional>
#include <vector>
constexpr int HTTPC_DISABLE_FOLLOW_REDIRECTS = 0;
inline std::vector<std::string> fakePayloads;
inline std::function<void()> fakeDuringPost;
inline int fakeCode = 200;
inline uint32_t fakeLatency = 0;
inline bool fakeBeginOK = true;
inline uint32_t fakeEnds = 0;
class HTTPClient {
 public:
  void setConnectTimeout(int n) { assert(n == 5000); }
  void setTimeout(int n) { assert(n == 5000); }
  void setFollowRedirects(int mode) { assert(mode == HTTPC_DISABLE_FOLLOW_REDIRECTS); }
  bool begin(const char* url) { assert(std::string(url) == "mock://sheets"); return fakeBeginOK; }
  void addHeader(const char* name, const char* value) {
    assert(std::string(name) == "Content-Type" && std::string(value) == "application/json");
  }
  int POST(const String& body) {
    fakePayloads.push_back(body.text);
    if (fakeDuringPost) fakeDuringPost();
    fakeNow += fakeLatency;
    return fakeCode;
  }
  void end() { ++fakeEnds; }
};
