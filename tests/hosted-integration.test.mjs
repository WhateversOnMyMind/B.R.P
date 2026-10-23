import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness, hash } from '../cloudflare/test/harness.mjs';
import { deriveState, commandPayload } from '../B.R.P Website/control/state.mjs';

test('operator command waits for left execution and right ESP-NOW revision confirmation', async () => {
  const h = await createHarness();
  await h.online();
  let view = deriveState(await h.state(), { authenticated: true });
  assert.equal(view.canCommandPair, true);
  const payload = commandPayload(view, 'set_motor_enabled', 'pair', false);
  const response = await h.request('/v1/operator/commands', { method: 'POST', body: payload });
  assert.equal(response.status, 201);
  const accepted = await response.json();
  view = deriveState(await h.state(), { authenticated: true });
  assert.equal(view.busy, true);
  assert.notEqual(view.commands[0].outcome.state, 'applied');
  const delivery = await (await h.exchange('L')).json();
  assert.equal(delivery.commands.length, 1);
  assert.equal(delivery.commands[0].id, accepted.id);
  assert.equal(delivery.commands[0].value, false);
  assert.equal(delivery.commands[0].bootId, '101');
  assert.equal((await (await h.exchange('R')).json()).commands.length, 0);
  const ack = { id: accepted.id, revision: accepted.revision, result: 'applied', message: '' };
  assert.equal((await h.exchange('L', { motorEnabled: false, commandedPwm: 0, settingsRevision: accepted.revision }, { ack })).status, 200);
  view = deriveState(await h.state(), { authenticated: true });
  assert.equal(view.commands[0].outcome.state, 'partial');
  assert.equal(view.arms.L.output, 0);
  assert.equal(view.canCommandPair, false);
  await h.exchange('R', { motorEnabled: false, commandedPwm: 0, settingsRevision: accepted.revision });
  view = deriveState(await h.state(), { authenticated: true });
  assert.equal(view.commands[0].outcome.state, 'applied');
  assert.equal(view.canCommandPair, true);
  const stale = deriveState(await h.state(), { authenticated: true, elapsedMs: 10001 });
  assert.equal(stale.canCommandPair, false);
});

test('private finalized capture is downloadable without returning board addresses', async () => {
  const h = await createHarness();
  await h.online();
  const view = deriveState(await h.state(), { authenticated: true });
  const start = await h.request('/v1/operator/commands', { method: 'POST', body: commandPayload(view, 'raw_start', 'L') });
  assert.equal(start.status, 201);
  const command = await start.json();
  const delivered = await (await h.exchange('L')).json();
  const captureId = delivered.commands[0].captureId;
  assert.equal(captureId, command.id);
  await h.exchange('L', { captureId, rawLogging: true, rawLogBytes: 26 }, { ack: { id: command.id, revision: command.revision, result: 'applied' } });
  const stopView = deriveState(await h.state(), { authenticated: true });
  const stop = await h.request('/v1/operator/commands', { method: 'POST', body: commandPayload(stopView, 'raw_stop', 'L') });
  assert.equal(stop.status, 201);
  const stopCommand = await stop.json();
  await h.exchange('L');
  const csv = 'ts_ms,ax,ay,az,gx,gy,gz,tempC\n1,0,0,1,0,0,0,25\n';
  const bytes = Buffer.byteLength(csv);
  await h.exchange('L', { captureId, rawLogging: false, rawLogBytes: bytes }, { ack: { id: stopCommand.id, revision: stopCommand.revision, result: 'applied' } });
  const upload = await h.request(`/v1/device/captures/${captureId}`, { as: 'L', method: 'PUT', body: csv,
    headers: { 'Content-Type': 'text/csv', 'Content-Length': String(bytes), 'X-Content-SHA256': hash(csv) } });
  assert.equal(upload.status, 200);
  const captureView = deriveState(await h.state(), { authenticated: true });
  assert.equal(captureView.arms.L.downloadableCapture.captureId, captureId);
  const download = await h.request(`/v1/operator/captures/left-a/${captureId}`);
  assert.equal(download.status, 200);
  assert.equal(await download.text(), csv);
  const denied = await h.request(`/v1/operator/captures/left-a/${captureId}`, { as: 'other' });
  assert.ok([403, 404].includes(denied.status));
});

test('reboot invalidates accepted intent and browser never reports applied', async () => {
  const h = await createHarness();
  await h.online();
  const response = await h.command();
  assert.equal(response.status, 201);
  await h.exchange('L', {}, { bootId: '303', sequence: 1 });
  const view = deriveState(await h.state(), { authenticated: true });
  assert.notEqual(view.commands[0].outcome.state, 'applied');
  assert.ok(['unknown', 'expired', 'failed'].includes(view.commands[0].outcome.state));
});
