#include "../CloudCommand.h"
#include <cassert>
#include <cmath>
#include <cstring>
#include <iostream>
using namespace cloud;
Command command(Action a = Action::Motor) {
  Command c{}; strcpy(c.id,"11111111-1111-4111-8111-111111111111");
  c.action=a; c.target='P'; c.boot=42; c.revision=7; c.receivedMs=100; c.ttlMs=1000;
  c.boolValue=true; return c;
}
int main() {
  Guard g; auto c=command();
  assert(g.check(c,'L',42,101,"")==Decision::Execute);
  g.remember(c,true);
  assert(g.check(c,'L',42,102,"")==Decision::Duplicate);
  c.revision=6; c.id[0]='2';
  assert(g.check(c,'L',42,102,"")==Decision::Reject);
  g=Guard{}; c=command();
  assert(g.check(c,'R',42,101,"")==Decision::Reject);
  assert(g.check(c,'L',43,101,"")==Decision::Reject);
  assert(g.check(c,'L',42,1100,"")==Decision::Reject);
  c.receivedMs=0xfffffff0; c.ttlMs=32;
  assert(g.check(c,'L',42,15,"")==Decision::Execute);
  assert(g.check(c,'L',42,16,"")==Decision::Reject);
  c=command(Action::Sensitivity); c.numberValue=NAN;
  assert(g.check(c,'L',42,101,"")==Decision::Reject);
  c.numberValue=0.301; assert(g.check(c,'L',42,101,"")==Decision::Reject);
  c.numberValue=-0.001; assert(g.check(c,'L',42,101,"")==Decision::Reject);
  c.numberValue=0.3; assert(g.check(c,'L',42,101,"")==Decision::Execute);
  c=command(Action::RawStart); c.target='R'; strcpy(c.captureId,c.id);
  assert(g.check(c,'R',42,101,"")==Decision::Execute);
  assert(g.check(c,'R',42,101,"old")==Decision::Reject);
  c.action=Action::RawClear;
  assert(g.check(c,'R',42,101,"old")==Decision::Reject);
  assert(g.check(c,'R',42,101,c.id)==Decision::Execute);
  c.action=Action::RawStop;
  assert(g.check(c,'R',42,101,c.id)==Decision::Execute);
  c.target='P'; assert(g.check(c,'R',42,101,c.id)==Decision::Reject);
  assert(validId("11111111-1111-4111-8111-111111111111"));
  assert(!validId("../../rawlog"));
  c=command(Action::Recalibrate); c.target='L'; c.ttlMs=3000;
  assert(g.check(c,'L',42,101,"")==Decision::Execute);
  assert(g.check(c,'L',42,701,"")==Decision::Reject);
  std::cout << "Cloud command safety tests passed\n";
}
