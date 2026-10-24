#include "../CaptureTiming.h"
#include <cassert>
#include <iostream>
int main() {
 using capture::sampleTiming; using capture::SampleTiming;
 // The loop timestamps a row before the worker publishes active=true.
 assert(sampleTiming(99,100)==SampleTiming::BeforeStart);
 assert(sampleTiming(100,100)==SampleTiming::WithinCapture);
 assert(sampleTiming(180099,100)==SampleTiming::WithinCapture);
 assert(sampleTiming(180100,100)==SampleTiming::Expired);
 assert(sampleTiming(16,0xfffffff0)==SampleTiming::WithinCapture);
 assert(sampleTiming(0xffffffef,0xfffffff0)==SampleTiming::BeforeStart);
 assert(sampleTiming(179984,0xfffffff0)==SampleTiming::Expired);
 std::cout<<"Capture start race and rollover tests passed\n";
}
