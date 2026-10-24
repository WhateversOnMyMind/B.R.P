#pragma once
#include <stdint.h>
#if __has_include("CloudConfig.h")
#include "CloudConfig.h"
#endif
#ifndef CLOUD_API_BASE
#define CLOUD_API_BASE ""
#endif
#ifndef CLOUD_DEVICE_KEY
#define CLOUD_DEVICE_KEY ""
#endif
#ifndef CLOUD_ROOT_CA
#define CLOUD_ROOT_CA ""
#endif
#ifndef CLOUD_PAIR_ID
#define CLOUD_PAIR_ID 0UL
#endif
#ifndef CLOUD_PEER_MAC
#define CLOUD_PEER_MAC {0,0,0,0,0,0}
#endif
#ifndef CLOUD_ESPNOW_PMK
#define CLOUD_ESPNOW_PMK {0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0}
#endif
#ifndef CLOUD_ESPNOW_LMK
#define CLOUD_ESPNOW_LMK {0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0}
#endif
namespace cloud {
static const uint8_t peerMac[6]=CLOUD_PEER_MAC;
static const uint8_t pmk[16]=CLOUD_ESPNOW_PMK;
static const uint8_t lmk[16]=CLOUD_ESPNOW_LMK;
inline bool pairingConfigured() {
 uint8_t m=0,p=0,l=0;
 for (auto b:peerMac) m|=b;
 for (auto b:pmk) p|=b;
 for (auto b:lmk) l|=b;
 return CLOUD_PAIR_ID!=0 && m && !(peerMac[0]&1) && p && l;
}
}
