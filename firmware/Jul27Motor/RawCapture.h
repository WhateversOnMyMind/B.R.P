#pragma once
#include <FS.h>
#include "CloudCommand.h"
namespace capture {
struct Status {
 bool ready=false,active=false,uploaded=false,uploading=false,recoveryRequired=false;
 uint32_t bytes=0,dropped=0; char id[37]{};
};
struct Row { uint32_t ms; float ax,ay,az,gx,gy,gz,tempC; };
struct Result { cloud::Command command; bool applied; };
bool begin();
Status status();
bool submit(const cloud::Command& command);
bool result(Result& result);
void sample(const Row& row);
// Network worker owns a read-only file while this lease is active. The capture
// worker rejects all mutations until finishUpload releases it.
bool openUpload(const char* expectedId,uint32_t expectedBytes,File& file);
void finishUpload(const char* id,bool verified);
}
