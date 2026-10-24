#include "../AlertWindow.h"
#include <cassert>
#include <cstdio>
int main() {
  telemetry::AlertWindow motor;
  assert(!motor.take(10000));
  motor.continuous(true, 11000);
  assert(motor.take(20000));
  assert(motor.take(30000));
  motor.stop(31000);
  assert(motor.take(40000));
  assert(!motor.take(50000));
  telemetry::AlertWindow pulse;
  pulse.pulse(70, 500);
  assert(pulse.take(10000)); // Short pulse ended long before upload.
  assert(!pulse.take(20000));
  pulse.pulse(70, 29980);
  assert(pulse.take(30000));
  assert(pulse.take(40000)); // Pulse straddled boundary.
  assert(!pulse.take(50000));
  pulse.pulse(70, 59930);
  assert(pulse.take(60000));
  assert(!pulse.take(70000)); // Expired exactly at boundary.
  pulse.pulse(70, 71000);
  pulse.stop(71010);
  assert(pulse.take(80000));
  assert(!pulse.take(90000));
  telemetry::AlertWindow wrap;
  wrap.pulse(70, 0xfffffff0U);
  assert(wrap.take(0));
  assert(wrap.take(100));
  assert(!wrap.take(200));
  telemetry::AlertWindow brief;
  brief.pulse(70, 100);
  brief.stop(100);
  assert(brief.take(10000)); // Even a same-millisecond output command counts.
  assert(!brief.take(20000));
  brief.continuous(true, 20100);
  brief.stop(20100);
  assert(brief.take(30000));
  assert(!brief.take(40000));
  brief.pulse(0, 40100);
  assert(!brief.take(50000));
  std::puts("PASS: alert windows, sustained output, short pulses, expiry, rollover");
}
