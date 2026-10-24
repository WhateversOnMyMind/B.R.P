#include "../PeerProtocol.h"
#include <cassert>
#include <limits>
#include <iostream>
int main() {
 const uint8_t expected[6]={2,3,4,5,6,7}, stranger[6]={2,3,4,5,6,8};
 cloud::PeerPacket p{}; p.magic=cloud::peerMagic; p.version=1;p.arm='L';p.pair=7;p.boot=9;p.sequence=1;p.motorEnabled=1;p.sensitivity=0.055;
 cloud::PeerGuard guard;
 assert(!guard.accept(p,stranger,expected,7,'R'));
 assert(guard.accept(p,expected,expected,7,'R'));
 assert(!guard.accept(p,expected,expected,7,'R'));
 p.sequence=2;p.pair=8;assert(!guard.accept(p,expected,expected,7,'R'));
 p.pair=7;p.version=2;assert(!guard.accept(p,expected,expected,7,'R'));
 p.version=1;p.arm='R';assert(!guard.accept(p,expected,expected,7,'R'));
 p.arm='L';p.sensitivity=std::numeric_limits<float>::quiet_NaN();assert(!guard.accept(p,expected,expected,7,'R'));
 p.sensitivity=0.055;p.boot=10;assert(guard.accept(p,expected,expected,7,'R'));
 p.boot=9;p.sequence=3;assert(!guard.accept(p,expected,expected,7,'R'));
  p.boot=0;assert(guard.accept(p,expected,expected,7,'R'));
 std::cout<<"Paired peer protocol tests passed\n";
}
