import test from 'node:test';
import assert from 'node:assert/strict';
import {createHarness} from './harness.mjs';

test('Cloudflare retains each arm latest measurement summary without a Sheets transport', async () => {
  const h = await createHarness();
  const left = {windowReady:true, windowSequence:1, windowCount:12,
    windowDistanceCm:345.67, windowAlerted:true, windowStartMs:5000,
    windowEndMs:15000, windowLateMs:0, windowMissedDeadlines:0};
  const right = {...left, windowCount:9, windowAlerted:false};
  assert.equal((await h.exchange('L', left)).status, 200);
  assert.equal((await h.exchange('R', right)).status, 200);
  let state = await h.state();
  for (const [arm, expected] of [['L', left], ['R', right]]) {
    const status = state.devices.find(d => d.arm === arm).status;
    for (const [key, value] of Object.entries(expected)) assert.equal(status[key], value);
  }
  const next = {...left, windowSequence:2, windowCount:0, windowDistanceCm:0,
    windowAlerted:false, windowStartMs:15000, windowEndMs:25000};
  assert.equal((await h.exchange('L', next)).status, 200);
  state = await h.state();
  const latest = state.devices.find(d => d.arm === 'L').status;
  for (const [key, value] of Object.entries(next)) assert.equal(latest[key], value);
  assert.equal(state.devices.find(d => d.arm === 'R').status.windowCount, 9);
  assert.equal(state.captures.length, 0); // Status is not an archived capture.
});
