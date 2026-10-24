#pragma once
#include <stdint.h>
#include <cstring>
#include <cmath>
namespace cloud {
constexpr uint32_t peerMagic=0x42425031;
struct __attribute__((packed)) PeerPacket {
 uint32_t magic=peerMagic; uint8_t version=1; char arm=0; uint32_t pair=0,boot=0,sequence=0;
 uint32_t count=0; float distance=0; uint8_t motorEnabled=1;
 float sensitivity=0.055; uint32_t settingsRevision=0;
 uint8_t authentication[16]{};
};
struct PeerGuard {
 uint32_t boot=0,sequence=0,retired[8]{}; uint8_t next=0,retiredCount=0; bool seen=false;
 bool accept(const PeerPacket& p,const uint8_t* source,const uint8_t* expected,uint32_t pair,char self) {
  if(!pair||!source||memcmp(source,expected,6)||p.magic!=peerMagic||p.version!=1||p.pair!=pair||
    p.arm!=(self=='L'?'R':'L')||!p.sequence||p.motorEnabled>1||
    !std::isfinite(p.sensitivity)||p.sensitivity<0||p.sensitivity>0.3f||
    !std::isfinite(p.distance)||p.distance<0) return false;
  if(seen&&p.boot==boot) { if(p.sequence<=sequence) return false; }
  else if(seen) {
   for(uint8_t i=0;i<retiredCount;++i) if(retired[i]==p.boot) return false;
   retired[next++%8]=boot;
   if(retiredCount<8) ++retiredCount;
  }
  boot=p.boot;sequence=p.sequence;seen=true;return true;
 }
};
}
