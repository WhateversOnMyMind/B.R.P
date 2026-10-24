#include "CloudControl.h"
#include "CloudSettings.h"
#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <cJSON.h>
#include <mbedtls/sha256.h>
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>
#include <freertos/task.h>
#include <time.h>
namespace cloud {
namespace {
QueueHandle_t snapshots=nullptr,commands=nullptr,acks=nullptr;
constexpr size_t responseCap=4096;
// HTTPClient streams decoded chunks into this fixed buffer; hostile Content-
// Length/chunked responses cannot allocate an unbounded String.
class Response : public Stream {
 public:
 char data[responseCap+1]{}; size_t used=0; bool overflow=false;
 size_t write(uint8_t b) override { return write(&b,1); }
 size_t write(const uint8_t* p,size_t n) override {
  if(n>responseCap-used) { overflow=true; return 0; }
  memcpy(data+used,p,n); used+=n; data[used]=0; return n;
 }
 int available() override { return 0; } int read() override { return -1; }
 int peek() override { return -1; } void flush() override {}
};
const cJSON* field(const cJSON* obj,const char* key) { return cJSON_GetObjectItemCaseSensitive(obj,key); }
const char* string(const cJSON* obj,const char* key) {
 const auto v=field(obj,key); return cJSON_IsString(v)?v->valuestring:nullptr;
}
bool integer(const cJSON* obj,const char* key,uint32_t& out) {
 auto v=field(obj,key);
 if(!cJSON_IsNumber(v)||!isfinite(v->valuedouble)||v->valuedouble<0||v->valuedouble>4294967295.0||floor(v->valuedouble)!=v->valuedouble) return false;
 out=uint32_t(v->valuedouble); return true;
}
bool bootValue(const char* s,uint32_t& out) {
 if(!s||!*s||strlen(s)>10) return false;
 uint64_t n=0; for(const char* p=s;*p;++p) { if(*p<'0'||*p>'9') return false; n=n*10+(*p-'0'); }
 if(n>UINT32_MAX) return false; out=uint32_t(n); return true;
}
bool parseCommand(const cJSON* v,Command& c,uint32_t requestStarted) {
 const char* id=string(v,"id"), *action=string(v,"action"), *target=string(v,"target");
 if(!validId(id)||!action||!target||!integer(v,"revision",c.revision)||!bootValue(string(v,"bootId"),c.boot)||!integer(v,"ttlMs",c.ttlMs)||c.ttlMs>15000) return false;
 strcpy(c.id,id); c.target=!strcmp(target,"pair")?'P':(!strcmp(target,"L")?'L':(!strcmp(target,"R")?'R':0));
 if(!strcmp(action,"set_motor_enabled")) { c.action=Action::Motor; auto value=field(v,"value"); if(!cJSON_IsBool(value)) return false; c.boolValue=cJSON_IsTrue(value); }
 else if(!strcmp(action,"set_sensitivity")) { c.action=Action::Sensitivity; auto value=field(v,"value"); if(!cJSON_IsNumber(value)) return false; c.numberValue=value->valuedouble; }
 else if(!strcmp(action,"raw_start")) c.action=Action::RawStart;
 else if(!strcmp(action,"raw_stop")) c.action=Action::RawStop;
 else if(!strcmp(action,"raw_clear")) c.action=Action::RawClear;
 else if(!strcmp(action,"recalibrate")) c.action=Action::Recalibrate;
 else return false;
 if(c.action==Action::RawStart||c.action==Action::RawStop||c.action==Action::RawClear) {
  const char* captureId=string(v,"captureId"); if(!validId(captureId)) return false; strcpy(c.captureId,captureId);
 }
 // A request can already have consumed some or all of the server's TTL.
 c.receivedMs=requestStarted; return true;
}
bool beginHttp(HTTPClient& http,WiFiClientSecure& tls,const String& path) {
 tls.setCACert(CLOUD_ROOT_CA); tls.setHandshakeTimeout(5);
 http.setConnectTimeout(5000); http.setTimeout(5000);
 http.setFollowRedirects(HTTPC_DISABLE_FOLLOW_REDIRECTS);
 if(!http.begin(tls,String(CLOUD_API_BASE)+path)) return false;
 http.addHeader("Authorization",String("Bearer ")+CLOUD_DEVICE_KEY);
 return true;
}
cJSON* readResponse(HTTPClient& http) {
 if(http.getSize()>int(responseCap)) return nullptr;
 Response response; if(http.writeToStream(&response)<0||response.overflow) return nullptr;
 const char* end=nullptr;
 return cJSON_ParseWithLengthOpts(response.data,response.used+1,&end,true);
}
void addStatus(cJSON* o,const Snapshot& s) {
 char arm[2]={s.arm,0}; cJSON_AddStringToObject(o,"arm",arm);
 cJSON_AddBoolToObject(o,"motorEnabled",s.motorEnabled);
 cJSON_AddNumberToObject(o,"feedbackDeadZone",s.feedbackDeadZone);
 cJSON_AddNumberToObject(o,"settingsRevision",s.settingsRevision);
 cJSON_AddBoolToObject(o,"peerFresh",s.peerFresh);
 cJSON_AddNumberToObject(o,"tempC",s.tempC);
 cJSON_AddStringToObject(o,"actuator","motor");
 cJSON_AddNumberToObject(o,"commandedPwm",s.commandedPwm);
 cJSON_AddBoolToObject(o,"feedbackEligible",s.feedbackEligible);
 cJSON_AddBoolToObject(o,"recalibrating",s.recalibrating);
 cJSON_AddBoolToObject(o,"rawLogging",s.capture.active);
 cJSON_AddNumberToObject(o,"rawLogBytes",s.capture.bytes);
 cJSON_AddStringToObject(o,"captureId",s.capture.id);
 cJSON_AddBoolToObject(o,"captureUploaded",s.capture.uploaded);
 cJSON_AddBoolToObject(o,"captureUploading",s.capture.uploading);
 cJSON_AddBoolToObject(o,"captureRecoveryRequired",s.capture.recoveryRequired);
 cJSON_AddBoolToObject(o,"captureReady",s.capture.ready);
 cJSON_AddNumberToObject(o,"captureDropped",s.capture.dropped);
 cJSON_AddBoolToObject(o,"windowReady",s.windowSequence!=0);
 cJSON_AddNumberToObject(o,"windowSequence",s.windowSequence);
 cJSON_AddNumberToObject(o,"windowCount",s.window.count);
 cJSON_AddNumberToObject(o,"windowDistanceCm",s.window.distanceCm);
 cJSON_AddBoolToObject(o,"windowAlerted",s.windowAlerted);
 cJSON_AddNumberToObject(o,"windowStartMs",s.window.startMs);
 cJSON_AddNumberToObject(o,"windowEndMs",s.window.endMs);
 cJSON_AddNumberToObject(o,"windowLateMs",s.window.lateMs);
 cJSON_AddNumberToObject(o,"windowMissedDeadlines",s.window.missedDeadlines);
 cJSON_AddNumberToObject(o,"maxSampleGapUs",s.maxSampleGapUs);
 cJSON_AddNumberToObject(o,"sampleGapCount",s.sampleGapCount);
 cJSON_AddNumberToObject(o,"uptimeMs",s.uptimeMs);
}
bool exchange(const Snapshot& s,uint32_t sequence,Ack& ack,Command& out,bool& hasCommand) {
 hasCommand=false;
 cJSON* body=cJSON_CreateObject(); if(!body) return false;
 char boot[11]; snprintf(boot,sizeof(boot),"%lu",static_cast<unsigned long>(s.boot));
 cJSON_AddStringToObject(body,"bootId",boot); cJSON_AddNumberToObject(body,"sequence",sequence);
 auto status=cJSON_AddObjectToObject(body,"status"); addStatus(status,s);
 if(ack.id[0]) {
  auto a=cJSON_AddObjectToObject(body,"ack"); cJSON_AddStringToObject(a,"id",ack.id);
  cJSON_AddNumberToObject(a,"revision",ack.revision); cJSON_AddStringToObject(a,"result",ack.applied?"applied":"failed");
  cJSON_AddStringToObject(a,"message",ack.message);
 } else cJSON_AddNullToObject(body,"ack");
 char* payload=cJSON_PrintUnformatted(body); cJSON_Delete(body); if(!payload) return false;
 WiFiClientSecure tls; HTTPClient http; bool ok=false;
 const uint32_t started=millis();
 if(beginHttp(http,tls,"/v1/device/exchange")) {
  http.addHeader("Content-Type","application/json");
  int code=http.POST(reinterpret_cast<uint8_t*>(payload),strlen(payload));
  // The server definitively rejects stale/invalid acknowledgments with 409.
  // Retrying that acknowledgment forever would suppress all future freshness.
  if(code==409) ack=Ack{};
  if(code==200) {
   cJSON* response=readResponse(http);
   auto list=field(response,"commands");
   ok=response && cJSON_IsNumber(field(response,"serverTimeMs")) && cJSON_IsArray(list) && cJSON_GetArraySize(list)<=1;
   if(ok&&cJSON_GetArraySize(list)==1) hasCommand=parseCommand(cJSON_GetArrayItem(list,0),out,started);
   cJSON_Delete(response);
  }
 }
 cJSON_free(payload); http.end(); return ok;
}
void upload(const capture::Status& expected) {
 File file; if(!capture::openUpload(expected.id,expected.bytes,file)) return;
 bool verified=false; mbedtls_sha256_context hash; mbedtls_sha256_init(&hash);
 int error=mbedtls_sha256_starts(&hash,0); uint8_t buffer[1024],digest[32]; uint32_t total=0;
 while(!error&&file.available()) {
  int n=file.read(buffer,sizeof(buffer)); if(n<=0) { error=-1; break; }
  total+=n; error=mbedtls_sha256_update(&hash,buffer,n); taskYIELD();
 }
 if(!error) error=mbedtls_sha256_finish(&hash,digest);
 mbedtls_sha256_free(&hash);
 if(!error && total==expected.bytes && file.seek(0)) {
  char hex[65]; for(int i=0;i<32;++i) snprintf(hex+2*i,3,"%02x",digest[i]);
  WiFiClientSecure tls; HTTPClient http;
  if(beginHttp(http,tls,String("/v1/device/captures/")+expected.id)) {
   http.addHeader("Content-Type","text/csv"); http.addHeader("X-Content-SHA256",hex);
   int code=http.sendRequest("PUT",&file,expected.bytes);
   if(code==200||code==201) {
    cJSON* response=readResponse(http); uint32_t bytes=0;
    const char* id=string(response,"captureId"),*sha=string(response,"sha256");
    verified=id&&sha&&!strcmp(id,expected.id)&&!strcmp(sha,hex)&&integer(response,"bytes",bytes)&&bytes==expected.bytes;
    cJSON_Delete(response);
   }
  }
  http.end();
 }
 file.close(); capture::finishUpload(expected.id,verified);
}
void task(void*) {
 Snapshot s; Ack pending; uint32_t sequence=0,backoff=2000;
 bool awaitingExecution=false;
 for(;;) {
  if(xQueuePeek(snapshots,&s,portMAX_DELAY)!=pdTRUE) continue;
  Ack incoming;
  if(xQueueReceive(acks,&incoming,0)==pdTRUE) { pending=incoming; awaitingExecution=false; }
  bool ok=false;
  if(WiFi.status()==WL_CONNECTED && time(nullptr)>1700000000 && sequence<UINT32_MAX) {
   Command c; bool hasCommand=false;
   ok=exchange(s,++sequence,pending,c,hasCommand);
   if(ok) {
    pending=Ack{};
    if(hasCommand && !awaitingExecution && xQueueSend(commands,&c,0)==pdTRUE) awaitingExecution=true;
    // Upload only the exact stopped generation already accepted as status.
    if(!hasCommand && !awaitingExecution && !s.capture.active && !s.capture.uploaded && s.capture.id[0]) upload(s.capture);
   }
  }
  backoff=ok?2000: (backoff<30000?min(backoff*2,30000UL):30000);
  vTaskDelay(pdMS_TO_TICKS(backoff));
 }
}
}
bool begin() {
 if(!configured()) return false;
 snapshots=xQueueCreate(1,sizeof(Snapshot)); commands=xQueueCreate(1,sizeof(Command)); acks=xQueueCreate(1,sizeof(Ack));
 if(!snapshots||!commands||!acks) return false;
 return xTaskCreatePinnedToCore(task,"cloud-control",12288,nullptr,1,nullptr,0)==pdPASS;
}
void publish(const Snapshot& s) { if(snapshots) xQueueOverwrite(snapshots,&s); }
bool receive(Command& c) { return commands && xQueueReceive(commands,&c,0)==pdTRUE; }
void acknowledge(const Command& c,bool applied,const char* message) {
 Ack ack; strcpy(ack.id,c.id); ack.revision=c.revision; ack.applied=applied; strlcpy(ack.message,message,sizeof(ack.message));
 if(acks) xQueueOverwrite(acks,&ack);
}
}
