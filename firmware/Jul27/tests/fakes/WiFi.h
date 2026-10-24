#pragma once
constexpr int WL_CONNECTED = 3;
inline bool fakeOnline = true;
struct FakeWiFi { int status() { return fakeOnline ? WL_CONNECTED : 0; } };
inline FakeWiFi WiFi;
