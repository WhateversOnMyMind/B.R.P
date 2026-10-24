#include "RawCapture.h"
#include "CaptureTiming.h"
#include <LittleFS.h>
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>
#include <freertos/task.h>
#include <freertos/semphr.h>
namespace capture {
namespace {
constexpr uint32_t maxBytes=2000160, maxMs=180000;
constexpr const char* path="/rawlog.csv";
constexpr const char* meta="/capture-id";
QueueHandle_t rows=nullptr,commands=nullptr,results=nullptr;
SemaphoreHandle_t lease=nullptr;
portMUX_TYPE mux=portMUX_INITIALIZER_UNLOCKED;
Status current;
File recording;
uint32_t started=0;
Status get() { portENTER_CRITICAL(&mux); auto s=current; portEXIT_CRITICAL(&mux); return s; }
void put(Status s) { portENTER_CRITICAL(&mux); s.dropped=current.dropped; current=s; portEXIT_CRITICAL(&mux); }
void stop() {
 recording.flush(); recording.close(); auto s=get(); s.active=false; put(s);
}
void task(void*) {
 for (;;) {
  cloud::Command c;
  if (xQueueReceive(commands,&c,0)==pdTRUE) {
   bool ok=false;
   if (xSemaphoreTake(lease,0)==pdTRUE) {
    auto s=get();
    if (!s.uploading && s.ready && uint32_t(millis()-c.receivedMs)<c.ttlMs) {
     if (c.action==cloud::Action::RawStart && !s.id[0] && !s.recoveryRequired && cloud::validId(c.captureId)) {
      // Persist identity before creating CSV. Interrupted starts remain visible
      // and require explicit clear; never silently overwrite an old capture.
      File identity=LittleFS.open(meta,"w");
      bool saved=identity && identity.write(reinterpret_cast<const uint8_t*>(c.captureId),36)==36;
      identity.close();
      if (saved) {
       strcpy(s.id,c.captureId); s.uploaded=false; put(s);
       recording=LittleFS.open(path,"w");
       const char header[]="ts_ms,ax,ay,az,gx,gy,gz,tempC\n";
       if(recording && recording.write(reinterpret_cast<const uint8_t*>(header),sizeof(header)-1)==sizeof(header)-1) {
        s.bytes=sizeof(header)-1; s.active=true; started=millis();
        xQueueReset(rows); ok=true;
       } else { recording.close(); s.recoveryRequired=true; }
       put(s);
      }
     } else if (!strcmp(s.id,c.captureId) && cloud::validId(c.captureId)) {
      if(c.action==cloud::Action::RawStop) { if(s.active) stop(); ok=true; }
      else if(c.action==cloud::Action::RawClear && !s.active) {
       // Data removal first: a failed identity removal cannot orphan a CSV.
       bool dataGone=!LittleFS.exists(path)||LittleFS.remove(path);
       bool idGone=dataGone && (!LittleFS.exists(meta)||LittleFS.remove(meta));
       if(idGone) { s=Status{}; s.ready=true; put(s); ok=true; }
      }
     }
    }
    xSemaphoreGive(lease);
   }
   Result r{c,ok}; xQueueSend(results,&r,portMAX_DELAY);
  }
  Row row;
  if (xQueueReceive(rows,&row,pdMS_TO_TICKS(10))==pdTRUE) {
   auto s=get();
   if(s.active) {
    const auto timing=sampleTiming(row.ms,started);
    if(timing==SampleTiming::BeforeStart) continue;
    char line[160]; int n=snprintf(line,sizeof(line),"%lu,%.4f,%.4f,%.4f,%.4f,%.4f,%.4f,%.2f\n",
       static_cast<unsigned long>(row.ms),row.ax,row.ay,row.az,row.gx,row.gy,row.gz,row.tempC);
    if(timing==SampleTiming::Expired || n<=0 || n>=int(sizeof(line)) || s.bytes+uint32_t(n)>maxBytes) stop();
    else {
     size_t written=recording.write(reinterpret_cast<const uint8_t*>(line),n);
     s.bytes+=written; put(s);
     if(written!=size_t(n)) stop();
    }
   }
  }
  if(get().active && uint32_t(millis()-started)>=maxMs) stop();
 }
}
}
bool begin() {
 if(!LittleFS.begin(false)) return false; // Never format a failed mount.
 lease=xSemaphoreCreateMutex(); rows=xQueueCreate(96,sizeof(Row));
 commands=xQueueCreate(1,sizeof(cloud::Command)); results=xQueueCreate(1,sizeof(Result));
 if(!lease||!rows||!commands||!results) return false;
 Status s; s.ready=true;
 File identity=LittleFS.open(meta,"r");
 if(identity) { size_t n=identity.readBytes(s.id,36); s.id[n]=0; identity.close(); }
 File existing=LittleFS.open(path,"r");
 const bool existingFile=bool(existing);
 if(existing) { s.bytes=existing.size(); existing.close(); }
 if((s.id[0] && !cloud::validId(s.id)) || (existingFile && !s.id[0])) {
  s.recoveryRequired=true; s.id[0]=0;
 }
 put(s);
 if(xTaskCreatePinnedToCore(task,"capture-io",4096,nullptr,1,nullptr,0)!=pdPASS) {
  s.ready=false; put(s); return false;
 }
 return true;
}
Status status() { return get(); }
bool submit(const cloud::Command& c) { return get().ready && commands && xQueueSend(commands,&c,0)==pdTRUE; }
bool result(Result& r) { return results && xQueueReceive(results,&r,0)==pdTRUE; }
void sample(const Row& row) {
 if(!get().active || !rows) return;
 if(xQueueSend(rows,&row,0)!=pdTRUE) { portENTER_CRITICAL(&mux); ++current.dropped; portEXIT_CRITICAL(&mux); }
}
bool openUpload(const char* id,uint32_t bytes,File& file) {
 if(!lease || xSemaphoreTake(lease,0)!=pdTRUE) return false;
 auto s=get(); bool ok=s.ready&&!s.active&&!s.uploading&&!s.uploaded&&!s.recoveryRequired &&
   cloud::validId(id)&&!strcmp(s.id,id)&&s.bytes==bytes&&bytes>0&&bytes<=maxBytes;
 if(ok) { file=LittleFS.open(path,"r"); ok=file && file.size()==bytes; }
 if(ok) { s.uploading=true; put(s); }
 else file.close();
 xSemaphoreGive(lease); return ok;
}
void finishUpload(const char* id,bool verified) {
 if(!lease) return;
 xSemaphoreTake(lease,portMAX_DELAY);
 auto s=get(); if(!strcmp(s.id,id)) { s.uploading=false; s.uploaded=verified; put(s); }
 xSemaphoreGive(lease);
}
}
