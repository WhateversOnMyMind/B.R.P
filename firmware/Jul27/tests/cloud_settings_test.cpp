#include <iostream>

#ifndef TEST_CONFIG_CASE
#define TEST_CONFIG_CASE 1
#endif
#if TEST_CONFIG_CASE != 0
#if TEST_CONFIG_CASE == 2
#define CLOUD_API_BASE "http://test.invalid"
#else
#define CLOUD_API_BASE "https://test.invalid"
#endif
#if TEST_CONFIG_CASE == 3
#define CLOUD_DEVICE_KEY "short"
#else
#define CLOUD_DEVICE_KEY "synthetic-test-key-never-use-on-a-device"
#endif
#if TEST_CONFIG_CASE != 4
#define CLOUD_ROOT_CA "-----BEGIN CERTIFICATE-----\nsynthetic-test-only"
#endif
#endif
#if TEST_CONFIG_CASE == 5
#define CLOUD_PAIR_ID 1UL
#define CLOUD_PEER_MAC {2,0,0,0,0,1}
#define CLOUD_ESPNOW_PMK {1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16}
#define CLOUD_ESPNOW_LMK {16,15,14,13,12,11,10,9,8,7,6,5,4,3,2,1}
#endif
// The runner copies the real header into an isolated include directory so
// these synthetic cases never load a user's private CloudConfig.h.
#include <CloudSettings.h>

int main() {
  if (cloud::pairingConfigured() != (TEST_CONFIG_CASE == 5)) {
    std::cerr << "Unexpected peer pairing readiness\n";
    return 1;
  }
  // A first board may connect to the API while peer feedback stays disabled.
  if (cloud::configured() != (TEST_CONFIG_CASE == 1 || TEST_CONFIG_CASE == 5)) {
    std::cerr << "Unexpected cloud readiness\n";
    return 1;
  }
  std::cout << "Cloud settings case " << TEST_CONFIG_CASE << " passed\n";
}
