import test from 'node:test';
import assert from 'node:assert/strict';
import { ControlApi, validateApiBase } from '../B.R.P Website/control/api.mjs';

test('configuration accepts only explicit HTTPS API URLs without credentials or local fallback', () => {
  assert.equal(validateApiBase('https://control.example.com/'), 'https://control.example.com');
  for (const url of ['', 'http://control.example.com', 'https://localhost', 'https://bb-right.local',
    'https://127.0.0.1', 'https://[::1]', 'https://user:key@example.com', 'https://example.com?key=bad']) {
    assert.throws(() => validateApiBase(url));
  }
});

test('a revoked operator key is forgotten and cannot authorize another request', async () => {
  const sent = [];
  const api = new ControlApi('https://control.example.com', async (url, options) => {
    sent.push(options.headers.Authorization);
    assert.equal(options.credentials, 'omit');
    assert.equal(options.redirect, 'error');
    return new Response('{"error":"revoked"}', { status: 401 });
  });
  api.signIn('test-only-key');
  await assert.rejects(api.state(), error => error.status === 401);
  assert.equal(api.authenticated, false);
  // The next view request is sent as a public read, without the forgotten key.
  await assert.rejects(api.state(), error => error.publicView === true);
  await assert.rejects(api.command({ expectedRevision: 0, action: 'set_motor_enabled', target: 'pair', value: false }), error => error.status === 401);
  assert.deepEqual(sent, ['Bearer test-only-key', undefined]);
});

test('signed-out viewing sends state and history requests without any key', async () => {
  const urls = [];
  const api = new ControlApi('https://control.example.com', async (url, options) => {
    urls.push(url);
    assert.equal(options.headers.Authorization, undefined);
    return new Response(url.includes('measurements') ? '{"records":[],"nextBeforeId":null}' : '{"pairId":"pair-a"}');
  });
  assert.equal((await api.state()).pairId, 'pair-a');
  assert.deepEqual((await api.measurements({ fromMs: 0, toMs: 1 })).records, []);
  await assert.rejects(api.download('device-L', 'capture-1'), error => error.status === 401);
  assert.equal(urls.length, 2);
});

test('signing out prevents an older in-flight response from restoring private state', async () => {
  let resolve;
  const api = new ControlApi('https://control.example.com', () => new Promise(done => { resolve = done; }));
  api.signIn('test-only-key');
  const request = api.state();
  api.signOut();
  resolve(new Response('{"pairId":"private"}'));
  await assert.rejects(request, error => error.name === 'SessionChangedError');
  assert.equal(api.authenticated, false);
});

test('command POST is sent once and never silently retries after an ambiguous network failure', async () => {
  let calls = 0;
  const api = new ControlApi('https://control.example.com', async (url, options) => {
    calls++;
    assert.equal(url, 'https://control.example.com/v1/operator/commands');
    assert.equal(options.method, 'POST');
    assert.deepEqual(JSON.parse(options.body), { expectedRevision: 2, action: 'set_motor_enabled', target: 'pair', value: false });
    throw new TypeError('network unavailable');
  });
  api.signIn('test-only-key');
  await assert.rejects(api.command({ expectedRevision: 2, action: 'set_motor_enabled', target: 'pair', value: false }));
  assert.equal(calls, 1);
});

test('capture download is an authenticated response, never a public object URL', async () => {
  const api = new ControlApi('https://control.example.com', async (url, options) => {
    assert.equal(url, 'https://control.example.com/v1/operator/captures/device-L/capture-1');
    assert.equal(options.headers.Authorization, 'Bearer test-only-key');
    return new Response('timestamp,value\n1,2\n', { headers: { 'Content-Type': 'text/csv' } });
  });
  api.signIn('test-only-key');
  const blob = await api.download('device-L', 'capture-1');
  assert.equal(await blob.text(), 'timestamp,value\n1,2\n');
});
