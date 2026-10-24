import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveState, commandPayload, commandOutcome, parseSensitivity, captureProblem } from '../B.R.P Website/control/state.mjs';

const device = (arm, extra = {}) => ({ id: `device-${arm}`, arm, bootId: '123', lastSeenMs: 99000,
  status: { arm, actuator: 'piezo', motorEnabled: true, feedbackDeadZone: 0.055, settingsRevision: 4,
    peerFresh: true, rawLogging: false, rawLogBytes: 0, captureId: '', captureUploaded: false }, ...extra });
const snapshot = (extra = {}) => ({ pairId: 'test-pair', revision: 4, serverTimeMs: 100000,
  devices: [device('L'), device('R')], commands: [], captures: [], ...extra });

test('uses server time plus elapsed time, not the browser wall clock, and disables stale devices', () => {
  const live = deriveState(snapshot(), { elapsedMs: 2000, authenticated: true });
  assert.equal(live.arms.L.ageMs, 3000);
  assert.equal(live.canCommandPair, true);
  const stale = deriveState(snapshot(), { elapsedMs: 9000, authenticated: true });
  assert.equal(stale.arms.L.fresh, false);
  assert.equal(stale.canCommandPair, false);
});

test('missing arm and malformed or future timestamps cannot enable controls', () => {
  for (const lastSeenMs of [undefined, NaN, '99000', 100001]) {
    const state = deriveState(snapshot({ devices: [device('L', { lastSeenMs })] }), { authenticated: true });
    assert.equal(state.arms.L.fresh, false);
    assert.equal(state.arms.R.fresh, false);
    assert.equal(state.canCommandPair, false);
  }
});

test('pending and partial commands lock new commands without claiming application', () => {
  const command = { id: 'cmd', revision: 5, action: 'set_motor_enabled', target: 'pair', value: false,
    createdMs: 99900, expiresMs: 114900, state: 'pending', results: { L: 'applied' } };
  const state = deriveState(snapshot({ commands: [command] }), { authenticated: true });
  assert.equal(state.canCommandPair, false);
  assert.equal(state.arms.L.canCommand, false);
  assert.equal(commandOutcome(command, 100000).state, 'partial');
  assert.equal(commandOutcome(command, 100000).arms.R, 'pending');
  assert.notEqual(commandOutcome({ ...command, state: 'applied' }, 100000).state, 'applied');
  assert.equal(commandOutcome({ ...command, state: 'applied', results: { L: 'applied', R: 'applied' } }, 100000).state, 'applied');
});

test('elapsed pending commands show unknown until backend resolves them and remain locked', () => {
  const command = { id: 'cmd', target: 'R', expiresMs: 99999, state: 'pending', results: {} };
  assert.equal(commandOutcome(command, 100000).state, 'unknown');
  assert.equal(deriveState(snapshot({ commands: [command] }), { authenticated: true }).arms.R.canCommand, false);
  assert.equal(commandOutcome({ ...command, state: 'expired' }, 100000).state, 'expired');
});

test('lost authentication, request in flight, and unavailable state disable every command', () => {
  for (const opts of [{ authenticated: false }, { authenticated: true, submitting: true }, { authenticated: true, uncertain: true }]) {
    const state = deriveState(snapshot(), opts);
    assert.equal(state.canCommandPair, false);
    assert.equal(state.arms.R.canCommand, false);
  }
  assert.equal(deriveState(null, { authenticated: true }).canCommandPair, false);
});

test('sensitivity accepts finite boundary values and rejects blanks, coercion and out-of-range input', () => {
  assert.equal(parseSensitivity('0'), 0);
  assert.equal(parseSensitivity('0.3'), 0.3);
  assert.equal(parseSensitivity('0.055'), 0.055);
  for (const value of ['', ' ', 'Infinity', 'NaN', '-0.001', '0.301', '0x10', null, false]) {
    assert.throws(() => parseSensitivity(value));
  }
});

test('commands preserve revision and explicit booleans and reject wrong arm authority', () => {
  const state = deriveState(snapshot(), { authenticated: true });
  assert.deepEqual(commandPayload(state, 'set_motor_enabled', 'pair', false), {
    expectedRevision: 4, action: 'set_motor_enabled', target: 'pair', value: false });
  assert.deepEqual(commandPayload(state, 'set_sensitivity', 'pair', '0.055'), {
    expectedRevision: 4, action: 'set_sensitivity', target: 'pair', value: 0.055 });
  assert.throws(() => commandPayload(state, 'set_motor_enabled', 'R', true));
  assert.throws(() => commandPayload(state, 'set_motor_enabled', 'pair', 'false'));
});

test('capture commands use the exact current identity and never overwrite existing captures', () => {
  const captured = device('R', { status: { ...device('R').status, captureId: 'capture-1', rawLogBytes: 123 } });
  const state = deriveState(snapshot({ devices: [device('L'), captured] }), { authenticated: true });
  assert.throws(() => commandPayload(state, 'raw_start', 'R'));
  assert.deepEqual(commandPayload(state, 'raw_clear', 'R'), {
    expectedRevision: 4, action: 'raw_clear', target: 'R', captureId: 'capture-1' });
  assert.throws(() => commandPayload(state, 'raw_stop', 'R'));
  assert.throws(() => commandPayload(state, 'raw_clear', 'L'));
  captured.status.rawLogging = true;
  const recording = deriveState(snapshot({ devices: [device('L'), captured] }), { authenticated: true });
  assert.throws(() => commandPayload(recording, 'raw_clear', 'R'));
  assert.deepEqual(commandPayload(recording, 'raw_stop', 'R'), {
    expectedRevision: 4, action: 'raw_stop', target: 'R', captureId: 'capture-1' });
});

test('enabled setting does not invent physical motor output or a successful upload', () => {
  const state = deriveState(snapshot(), { authenticated: true });
  assert.equal(state.arms.L.motorEnabled, true);
  assert.equal(state.arms.L.output, null);
  assert.equal(state.arms.L.downloadableCapture, null);
});

test('piezo feedback uses cadence intensity and never treats legacy motor PWM as a beep', () => {
  const piezo = device('L', { status: { ...device('L').status,
    feedbackIntensity: 0.5, toneActive: false, toneHz: 4000, pulsePeriodMs: 600, commandedPwm: 255 } });
  const view = deriveState(snapshot({ devices: [piezo, device('R')] }), { authenticated: true });
  assert.equal(view.arms.L.output, 0.5);
  assert.equal(view.arms.L.toneActive, false);
  assert.equal(view.arms.L.pulsePeriodMs, 600);
  assert.equal(view.canCommandPair, true);
});

test('unidentified firmware cannot receive feedback controls', () => {
  for (const actuator of ['unknown', undefined]) {
    const other = device('R', { status: { ...device('R').status, actuator, commandedPwm: 128 } });
    const view = deriveState(snapshot({ devices: [device('L'), other] }), { authenticated: true });
    assert.equal(view.arms.R.compatible, false);
    assert.equal(view.arms.R.output, null);
    assert.equal(view.arms.R.canCommand, false);
    assert.equal(view.canCommandPair, false);
    assert.throws(() => commandPayload(view, 'set_motor_enabled', 'pair', true));
  }
});

test('motor pairs use commanded PWM without interpreting piezo tone fields', () => {
  const devices = ['L', 'R'].map(arm => device(arm, {status: {...device(arm).status,
    actuator: 'motor', commandedPwm: 128, feedbackIntensity: 1, toneActive: true, pulsePeriodMs: 200}}));
  const view = deriveState(snapshot({devices}), {authenticated:true});
  assert.equal(view.canCommandPair, true);
  assert.equal(view.pairActuator, 'motor');
  assert.equal(view.arms.L.output, 128 / 255);
  assert.equal(view.arms.L.commandedPwm, 128);
  assert.equal(view.arms.L.toneActive, null);
  assert.equal(view.arms.L.pulsePeriodMs, null);
  assert.equal(commandPayload(view, 'set_motor_enabled', 'pair', false).value, false);
  assert.equal(commandPayload(view, 'recalibrate', 'R').target, 'R');
});

test('mixed actuator pairs allow per-arm maintenance but block shared feedback settings', () => {
  const motor = device('R', {status: {...device('R').status, actuator:'motor', commandedPwm:0}});
  const view = deriveState(snapshot({devices:[device('L'), motor]}), {authenticated:true});
  assert.equal(view.canCommandPair, false);
  assert.equal(view.pairActuator, null);
  assert.equal(view.arms.R.canCommand, true);
  assert.throws(() => commandPayload(view, 'set_motor_enabled', 'pair', true));
  assert.equal(commandPayload(view, 'recalibrate', 'R').target, 'R');
});

test('invalid motor PWM is never displayed as a measured output', () => {
  for (const commandedPwm of [undefined, -1, 256, 1.5, '128', NaN]) {
    const motor = device('L', {status: {...device('L').status, actuator:'motor', commandedPwm}});
    const view = deriveState(snapshot({devices:[motor]}), {authenticated:true});
    assert.equal(view.arms.L.output, null);
    assert.equal(view.arms.L.commandedPwm, null);
  }
});

test('capture storage failures block new recordings and explain preserved recovery files', () => {
  for (const flags of [{ captureReady: false }, { captureRecoveryRequired: true }]) {
    const broken = device('L', { status: { ...device('L').status, ...flags } });
    const state = deriveState(snapshot({ devices: [broken, device('R')] }), { authenticated: true });
    assert.throws(() => commandPayload(state, 'raw_start', 'L'), /storage|recovery/i);
    assert.match(captureProblem(state.arms.L.status), /storage|recovery/i);
    assert.doesNotThrow(() => commandPayload(state, 'raw_start', 'R'));
  }
  assert.match(captureProblem({ captureReady: false, captureRecoveryRequired: true }), /preserved/i);
  assert.equal(captureProblem({ captureReady: true }), '');
});
