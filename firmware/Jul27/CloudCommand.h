#pragma once
#include <stdint.h>
#include <cstring>
#include <cmath>
namespace cloud {
enum class Action { Motor, Sensitivity, RawStart, RawStop, RawClear, Recalibrate, Invalid };
enum class Decision { Execute, Duplicate, Reject };
struct Command {
 char id[37]{}, captureId[37]{};
 uint32_t revision=0,boot=0,receivedMs=0,ttlMs=0;
 Action action=Action::Invalid; char target=0; bool boolValue=false; double numberValue=0;
};
inline bool validId(const char* s) {
 if (!s || strlen(s)!=36) return false;
 for (int i=0;i<36;++i) {
   if (i==8 || i==13 || i==18 || i==23) { if(s[i]!='-') return false; }
   else if (!((s[i]>='0'&&s[i]<='9')||(s[i]>='a'&&s[i]<='f'))) return false;
 }
 return true;
}
struct Guard {
 uint32_t revision=0; char id[37]{}; bool applied=false;
 Decision check(const Command& c,char arm,uint32_t boot,uint32_t now,const char* capture) const {
   if (!validId(c.id) || c.boot!=boot || !c.revision) return Decision::Reject;
   if (c.revision==revision && !strcmp(c.id,id)) return Decision::Duplicate;
   if (c.revision<=revision || !c.ttlMs || c.ttlMs>15000 || uint32_t(now-c.receivedMs)>=c.ttlMs) return Decision::Reject;
   const bool shared=c.action==Action::Motor || c.action==Action::Sensitivity;
   if (shared ? (arm!='L'||c.target!='P') : c.target!=arm) return Decision::Reject;
   if (c.action==Action::Invalid) return Decision::Reject;
   if (c.action==Action::Recalibrate && c.ttlMs-uint32_t(now-c.receivedMs)<=2400) return Decision::Reject;
   if (c.action==Action::Sensitivity && (!std::isfinite(c.numberValue)||c.numberValue<0||c.numberValue>0.3)) return Decision::Reject;
   if (c.action==Action::RawStart && (*capture || !validId(c.captureId) || strcmp(c.captureId,c.id))) return Decision::Reject;
   if ((c.action==Action::RawStop || c.action==Action::RawClear) && (!validId(c.captureId)||strcmp(c.captureId,capture))) return Decision::Reject;
   return Decision::Execute;
 }
 void remember(const Command& c,bool result) { revision=c.revision; strcpy(id,c.id); applied=result; }
};
}
