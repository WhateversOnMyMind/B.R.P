#pragma once
#include "CloudCommand.h"
#include "RawCapture.h"
#include "TelemetryTiming.h"
namespace cloud {
struct Snapshot {
 char arm='?'; uint32_t boot=0,settingsRevision=0,uptimeMs=0;
 bool motorEnabled=true,peerFresh=false,recalibrating=false,feedbackEligible=false;
 float feedbackDeadZone=0.055f,tempC=0,feedbackIntensity=0;
 bool toneActive=false,magnetometerReady=false; uint16_t pulsePeriodMs=0;
 uint32_t maxSampleGapUs=0,sampleGapCount=0;
 telemetry::Window window{}; uint32_t windowSequence=0; bool windowAlerted=false;
 capture::Status capture{};
};
struct Ack { char id[37]{}; uint32_t revision=0; bool applied=false; char message[64]{}; };
bool configured();
bool begin();
void publish(const Snapshot& snapshot);
bool receive(Command& command);
void acknowledge(const Command& command,bool applied,const char* message);
}
