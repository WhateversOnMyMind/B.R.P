const ARMS = ['L', 'R'];
const STALE_MS = 10000;
const number = value => typeof value === 'number' && Number.isFinite(value);
const outcome = value => typeof value === 'string' ? value : value?.result;

export function commandOutcome(command, serverNowMs) {
  const required = command.target === 'pair' ? ARMS : [command.target];
  const arms = Object.fromEntries(required.map(arm => [arm, outcome(command.results?.[arm]) || 'pending']));
  let state = command.state;
  if (!['failed', 'expired', 'unknown'].includes(state)) {
    if (required.every(arm => arms[arm] === 'applied') && state === 'applied') state = 'applied';
    else if (required.some(arm => arms[arm] === 'failed')) state = 'failed';
    else if (number(command.expiresMs) && serverNowMs >= command.expiresMs) state = 'unknown';
    else if (required.some(arm => arms[arm] === 'applied')) state = 'partial';
    else state = 'pending';
  }
  return { state, arms };
}

export function deriveState(snapshot, { elapsedMs = 0, authenticated = false, submitting = false, uncertain = false } = {}) {
  const valid = snapshot && number(snapshot.serverTimeMs) && Number.isSafeInteger(snapshot.revision) && snapshot.revision >= 0;
  const serverNowMs = valid ? snapshot.serverTimeMs + Math.max(0, elapsedMs) : 0;
  const commands = Array.isArray(snapshot?.commands) ? snapshot.commands : [];
  const busy = submitting || uncertain || commands.some(command => command.state === 'pending');
  const unlocked = Boolean(valid && authenticated && !busy);
  const arms = Object.fromEntries(ARMS.map(arm => {
    const matches = (snapshot?.devices || []).filter(item => item.arm === arm);
    const device = matches.length === 1 ? matches[0] : null;
    const status = device?.status || {};
    const ageMs = valid && number(device?.lastSeenMs) && device.lastSeenMs <= snapshot.serverTimeMs
      ? serverNowMs - device.lastSeenMs : null;
    const fresh = ageMs !== null && ageMs >= 0 && ageMs < STALE_MS;
    const actuator = ['piezo', 'motor'].includes(status.actuator) ? status.actuator : null;
    const compatible = actuator !== null;
    const commandedPwm = actuator === 'motor' && Number.isInteger(status.commandedPwm) &&
      status.commandedPwm >= 0 && status.commandedPwm <= 255 ? status.commandedPwm : null;
    const downloadableCapture = (snapshot?.captures || []).find(capture =>
      capture.deviceId === device?.id && capture.captureId === status.captureId) || null;
    return [arm, { device, status, ageMs, fresh, actuator, compatible, commandedPwm, canCommand: unlocked && fresh && compatible,
      motorEnabled: typeof status.motorEnabled === 'boolean' ? status.motorEnabled : null,
      output: actuator === 'motor' ? (commandedPwm === null ? null : commandedPwm / 255) :
        actuator === 'piezo' && number(status.feedbackIntensity) && status.feedbackIntensity >= 0 && status.feedbackIntensity <= 1 ? status.feedbackIntensity : null,
      toneActive: actuator === 'piezo' && typeof status.toneActive === 'boolean' ? status.toneActive : null,
      pulsePeriodMs: actuator === 'piezo' && number(status.pulsePeriodMs) && status.pulsePeriodMs >= 0 ? status.pulsePeriodMs : null,
      downloadableCapture }];
  }));
  const pairActuator = arms.L.actuator && arms.L.actuator === arms.R.actuator ? arms.L.actuator : null;
  return { revision: snapshot?.revision, pairId: snapshot?.pairId, serverNowMs, busy, arms, pairActuator,
    canCommandPair: arms.L.canCommand && arms.R.canCommand && pairActuator !== null,
    commands: commands.map(command => ({ ...command, outcome: commandOutcome(command, serverNowMs) })) };
}

export function parseSensitivity(value) {
  if ((typeof value !== 'string' && typeof value !== 'number') ||
      (typeof value === 'string' && !/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(value.trim()))) {
    throw new Error('Enter a number from 0 to 0.3.');
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 0.3) throw new Error('Sensitivity must be between 0 and 0.3.');
  return parsed;
}

export function captureProblem(status) {
  if (status.captureRecoveryRequired === true) return 'Capture recovery required. The existing file is preserved; recover it from the device before recording again.';
  if (status.captureReady === false) return 'Capture storage unavailable. Check the device storage before recording.';
  return '';
}

export function commandPayload(state, action, target, value) {
  const payload = { expectedRevision: state.revision, action, target };
  if (action === 'set_motor_enabled' || action === 'set_sensitivity') {
    if (target !== 'pair' || !state.canCommandPair) throw new Error('Both arms must be fresh with matching hardware and no command can be pending.');
    if (action === 'set_motor_enabled') {
      if (typeof value !== 'boolean') throw new Error('Feedback enable must be true or false.');
      payload.value = value;
    } else payload.value = parseSensitivity(value);
    return payload;
  }
  if (!ARMS.includes(target) || !state.arms[target].canCommand) throw new Error('This arm is unavailable or a command is pending.');
  const status = state.arms[target].status;
  if (action === 'raw_start') {
    const problem = captureProblem(status);
    if (problem) throw new Error(problem);
    if (status.captureId || status.rawLogging) throw new Error('Clear the existing stopped local capture before starting another.');
  } else if (action === 'raw_stop' || action === 'raw_clear') {
    if (!status.captureId) throw new Error('No local capture is available.');
    if (action === 'raw_stop' && !status.rawLogging) throw new Error('The capture is already stopped.');
    if (action === 'raw_clear' && status.rawLogging) throw new Error('Stop the capture before clearing it.');
    payload.captureId = status.captureId;
  } else if (action === 'recalibrate') {
    if (status.recalibrating || status.rawLogging) throw new Error('Stop recording and wait for any recalibration to finish.');
  } else throw new Error('Unsupported command.');
  return payload;
}
