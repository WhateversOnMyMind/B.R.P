#pragma once
#include "PeerProtocol.h"
#include "CloudSettings.h"
#include <mbedtls/md.h>
#include <stddef.h>
namespace cloud {
inline bool peerTag(const PeerPacket& packet,uint8_t* out) {
 const auto* info=mbedtls_md_info_from_type(MBEDTLS_MD_SHA256);
 return info && mbedtls_md_hmac(info,lmk,sizeof(lmk),reinterpret_cast<const uint8_t*>(&packet),offsetof(PeerPacket,authentication),out)==0;
}
inline bool signPeer(PeerPacket& packet) {
 uint8_t tag[32]; if(!peerTag(packet,tag)) return false;
 memcpy(packet.authentication,tag,16); return true;
}
inline bool authenticPeer(const PeerPacket& packet) {
 uint8_t tag[32]; if(!peerTag(packet,tag)) return false;
 uint8_t difference=0;
 for(int i=0;i<16;++i) difference|=tag[i]^packet.authentication[i];
 return difference==0;
}
}
