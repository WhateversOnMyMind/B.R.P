#pragma once
#include <stdint.h>
namespace capture {
enum class SampleTiming { BeforeStart, WithinCapture, Expired };
inline SampleTiming sampleTiming(uint32_t sampleMs,uint32_t startedMs) {
 // Captures last three minutes, far below the half-range ambiguity. A row
 // timestamped immediately before active was published must be ignored.
 if(int32_t(sampleMs-startedMs)<0) return SampleTiming::BeforeStart;
 return uint32_t(sampleMs-startedMs)>=180000 ? SampleTiming::Expired : SampleTiming::WithinCapture;
}
}
