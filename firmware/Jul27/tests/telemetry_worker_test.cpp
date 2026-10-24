// Compile the actual worker against narrow fakes for ESP32-only APIs.
#include "../Telemetry.cpp"
#include <cassert>
#include <cstdio>

void drain() { try { fakeTask(nullptr); } catch (const WorkerIdle&) {} }
int main(int argc, char** argv) {
  using namespace telemetry;
  assert(argc == 2);
  const std::string test = argv[1];
  Job job{};
  job.arm = 'R'; job.sequence = 1;
  job.window = {0,10000,0,0,7,125.0f};
  if (test == "queue-failure" || test == "task-failure") {
    fakeQueueFailure = test == "queue-failure";
    fakeTaskFailure = test == "task-failure";
    assert(!begin("mock://sheets"));
    assert(!enqueue(job) && status().dropped == 1 && !status().ready);
    assert(status().queued == 0);
    fakeQueueFailure = fakeTaskFailure = false;
    assert(begin("mock://sheets"));
    assert(enqueue(job)); drain(); assert(status().succeeded == 1);
  } else {
    assert(begin("mock://sheets"));
    if (test == "overflow") {
      for (uint32_t i=0;i<12;++i) { job.window.count=i; assert(enqueue(job)); }
      assert(!enqueue(job));
      assert(status().queued == 12 && status().dropped == 1);
      job.window.count = 999;
      drain();
      assert(fakePayloads.size() == 12);
      assert(fakePayloads.front() == "{\"arm\":\"R\",\"count\":0,\"distance\":125.00,\"alerted\":false}");
      assert(fakePayloads.back() == "{\"arm\":\"R\",\"count\":11,\"distance\":125.00,\"alerted\":false}");
    } else if (test == "slow") {
      fakeLatency = 15000;
      assert(enqueue(job));
      fakeDuringPost = [&] {
        // A producer adds the next window while the first POST is in flight.
        if (fakePayloads.size() == 1) {
          assert(status().busy);
          job.sequence = 2; job.window.count = 3; job.arm = 'L'; job.alerted = true;
          assert(enqueue(job));
        }
      };
      drain();
      assert(fakePayloads.size() == 2 && status().succeeded == 2);
      assert(fakePayloads[0] == "{\"arm\":\"R\",\"count\":7,\"distance\":125.00,\"alerted\":false}");
      assert(fakePayloads[1] == "{\"arm\":\"L\",\"count\":3,\"distance\":125.00,\"alerted\":true}");
      assert(status().lastStartMs == 15000 && status().lastEndMs == 30000);
      assert(status().lastDurationMs == 15000 && !status().busy);
    } else if (test == "toggle") {
      job.kind = Kind::Toggle; job.enabled = false; job.epochSeconds = 1700000000;
      assert(enqueue(job)); job.enabled = true; job.epochSeconds = 1700000010;
      fakeNow = 25000; drain();
      assert(fakePayloads[0] == "{\"event\":\"motor_toggle\",\"state\":\"off\",\"ts\":1700000000}");
    } else {
      if (test == "offline") fakeOnline = false;
      else if (test == "redirect") fakeCode = 302;
      else if (test == "http-error") fakeCode = 503;
      else if (test == "timeout") fakeCode = -11;
      else if (test == "begin-failure") fakeBeginOK = false;
      else assert(false);
      assert(enqueue(job)); drain();
      assert(status().succeeded == 0 && status().queued == 0);
      assert(status().failed == (test == "redirect" ? 0U : 1U));
      assert(status().unconfirmed == (test == "redirect" ? 1U : 0U));
      assert(fakePayloads.size() == ((test == "offline" || test == "begin-failure") ? 0U : 1U));
      assert(fakeEnds == (test == "offline" ? 0U : 1U));
    }
  }
  std::printf("PASS: worker %s\n", argv[1]);
}
