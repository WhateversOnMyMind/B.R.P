import { API_BASE_URL } from './config.mjs';
import { ControlApi } from './api.mjs';
import { deriveState, commandPayload, captureProblem } from './state.mjs';

const $ = id => document.getElementById(id);
const actionNames = { set_motor_enabled: 'Feedback setting', set_sensitivity: 'Sensitivity', raw_start: 'Start capture', raw_stop: 'Stop capture', raw_clear: 'Clear local capture', recalibrate: 'Recalibrate' };
let api;
let snapshot = null;
let snapshotAt = 0;
let refreshing = false;
let submitting = false;
let connected = false;
let pendingReceipt = null;
let sessionEpoch = 0;
let historyInitialized = false, historyBusy = false, historyExporting = false;
let historyRows = [], historyBeforeId = null;
const cards = {};

function message(text, error = false) { $('message').textContent = text; $('message').dataset.error = String(error); }
function currentState() {
  return deriveState(snapshot, { elapsedMs: performance.now() - snapshotAt,
    authenticated: Boolean(api?.authenticated), submitting, uncertain: Boolean(pendingReceipt) || !connected });
}
function canRun(state, action, arm) {
  try { commandPayload(state, action, arm); return true; } catch { return false; }
}
function setText(card, field, value) { card.querySelector(`[data-field="${field}"]`).textContent = value; }
function numberText(value, suffix = '') { return typeof value === 'number' && Number.isFinite(value) ? `${value}${suffix}` : 'Not reported'; }

for (const arm of ['L', 'R']) {
  const card = $('arm-template').content.firstElementChild.cloneNode(true);
  card.dataset.arm = arm;
  setText(card, 'side', arm === 'L' ? 'LEFT / SHARED SETTINGS LEAD' : 'RIGHT / PAIRED DEVICE');
  setText(card, 'title', arm === 'L' ? 'Left arm' : 'Right arm');
  card.querySelectorAll('[data-action]').forEach(button => {
    button.setAttribute('aria-label', `${button.textContent.trim()} · ${arm === 'L' ? 'left' : 'right'} arm`);
    button.addEventListener('click', () => {
      if (button.dataset.action === 'download') {
        const capture = currentState().arms[arm].downloadableCapture;
        if (capture) void download(capture);
      } else void submit(button.dataset.action, arm);
    });
  });
  $('arms').append(card);
  cards[arm] = card;
}

function render() {
  const state = currentState();
  const signedIn = Boolean(api?.authenticated && snapshot);
  $('workspace').hidden = !signedIn;
  $('login-panel').hidden = signedIn;
  $('connection').textContent = !api ? 'Not configured' : !signedIn ? 'Signed out' : !connected ? 'Connection interrupted' : state.arms.L.fresh && state.arms.R.fresh ? 'Pair connected' : 'Waiting for fresh devices';
  $('connection').dataset.tone = signedIn && (!connected || !state.arms.L.fresh || !state.arms.R.fresh) ? 'stale' : '';
  $('pair-label').textContent = signedIn ? `Pair ${state.pairId} · revision ${state.revision}` : '';
  $('refresh').disabled = refreshing;
  $('feedback-on').disabled = !state.canCommandPair;
  $('feedback-off').disabled = !state.canCommandPair;
  $('feedback-title').textContent = state.pairActuator === 'motor' ? 'Motor feedback setting' : state.pairActuator === 'piezo' ? 'Piezo feedback setting' : 'Feedback setting';
  $('feedback-help').textContent = state.pairActuator === 'motor'
    ? 'Allow or disable vibration on the pair. Balance is recalculated every 5 seconds; stronger imbalance increases motor PWM.'
    : state.pairActuator === 'piezo'
    ? 'Allow or disable 4 kHz beeps on the pair. Balance is recalculated every 5 seconds; stronger imbalance makes the 70 ms beeps more frequent.'
    : 'Connect both arms with matching motor or piezo firmware to control feedback.';
  $('sensitivity-submit').disabled = !state.canCommandPair;
  $('shared-status').textContent = pendingReceipt ? 'Awaiting command record' : state.busy ? 'Command pending' : state.canCommandPair ? 'Ready' : state.arms.L.actuator && state.arms.R.actuator && !state.pairActuator ? 'Hardware mismatch' : 'Controls unavailable';
  for (const arm of ['L', 'R']) {
    const data = state.arms[arm];
    const status = data.status;
    const card = cards[arm];
    setText(card, 'freshness', data.fresh ? 'Fresh' : data.device ? 'Stale / offline' : 'Not seen');
    card.querySelector('[data-field="freshness"]').dataset.tone = data.fresh ? '' : 'stale';
    setText(card, 'identity', data.device ? `${data.device.id} · boot ${data.device.bootId}` : 'No device has reported yet.');
    setText(card, 'enabled', data.motorEnabled === null ? 'Not reported' : data.motorEnabled ? 'ON' : 'OFF');
    setText(card, 'enabled-label', data.actuator === 'motor' ? 'Motor feedback setting' : data.actuator === 'piezo' ? 'Piezo feedback setting' : 'Feedback setting');
    setText(card, 'output-label', data.actuator === 'motor' ? 'Motor PWM command' : 'Feedback intensity');
    setText(card, 'output', data.output === null ? 'Not reported' : data.actuator === 'motor' ? `${data.commandedPwm} / 255 (${Math.round(data.output * 100)}%)` : Math.round(data.output * 100) + '%');
    setText(card, 'hardware', data.actuator === 'motor' ? 'Vibration motor · PWM' : data.actuator === 'piezo' ? 'Piezo · 4 kHz' : data.device ? 'Unrecognized firmware' : 'Not reported');
    card.querySelector('[data-field="cadence"]').parentElement.hidden = data.actuator !== 'piezo';
    card.querySelector('[data-field="tone"]').parentElement.hidden = data.actuator !== 'piezo';
    setText(card, 'cadence', data.pulsePeriodMs === null ? 'Not reported' : data.pulsePeriodMs === 0 ? 'Silent' : data.pulsePeriodMs + ' ms between beeps');
    setText(card, 'tone', data.toneActive === null ? 'Not reported' : data.toneActive ? 'ON at last report' : 'OFF at last report');
    setText(card, 'sensitivity', numberText(status.feedbackDeadZone));
    setText(card, 'revision', numberText(status.settingsRevision));
    setText(card, 'peer', status.peerFresh === true ? 'Fresh' : status.peerFresh === false ? 'Stale' : 'Not reported');
    setText(card, 'age', data.ageMs === null ? 'Not available' : `${Math.floor(data.ageMs / 1000)} s ago`);
    setText(card, 'capture-status', captureProblem(status) || (status.rawLogging ? `Recording · ${numberText(status.rawLogBytes, ' bytes')}` : status.captureId ? `${data.downloadableCapture ? 'Saved to cloud' : 'Stopped · upload not yet verified'} · ${numberText(status.rawLogBytes, ' bytes')}` : 'No local capture'));
    setText(card, 'capture-id', status.captureId || '');
    setText(card, 'calibration', status.recalibrating ? 'Recalibration in progress. Keep still.' : 'Keep this arm still during recalibration.');
    card.querySelectorAll('[data-action]').forEach(button => {
      button.disabled = button.dataset.action === 'download' ? !signedIn || !data.downloadableCapture : !canRun(state, button.dataset.action, arm);
    });
  }
  renderActivity(state);
  renderCaptures();
  renderHistoryControls();
}

function renderHistoryControls() {
  const disabled = !api?.authenticated || historyBusy || historyExporting;
  for (const id of ['history-date', 'history-refresh', 'history-download', 'history-more']) $(id).disabled = disabled;
  $('history-more').hidden = historyBeforeId === null;
}

function historyRange() {
  const value = $('history-date').value;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Choose a date for the logs.');
  const from = new Date(value + 'T00:00:00');
  const to = new Date(from); to.setDate(to.getDate() + 1);
  if (!Number.isFinite(from.getTime())) throw new Error('Choose a valid date.');
  return { fromMs: from.getTime(), toMs: to.getTime() };
}

async function loadHistory(append = false) {
  if (!api?.authenticated || historyBusy || historyExporting) return;
  let range;
  try { range = historyRange(); } catch (error) { $('history-status').textContent = error.message; return; }
  const epoch = sessionEpoch;
  historyBusy = true;
  if (!append) { historyRows = []; historyBeforeId = null; $('history-rows').replaceChildren(); }
  $('history-status').textContent = 'Loading saved summaries…'; renderHistoryControls();
  try {
    const page = await api.measurements({ ...range, limit: 50, ...(append && historyBeforeId !== null ? { beforeId: historyBeforeId } : {}) });
    if (epoch !== sessionEpoch) return;
    if (!Array.isArray(page.records)) throw new Error('Invalid history response.');
    historyRows.push(...page.records); historyBeforeId = page.nextBeforeId;
    for (const row of page.records) {
      const tr = document.createElement('tr');
      const measuredArm = row.arm === 'L' ? 'Left arm' : row.arm === 'R' ? 'Right arm' : 'Not reported';
      for (const value of [new Date(row.receivedMs).toLocaleString(), measuredArm, row.count, Number(row.distanceCm).toFixed(2)]) {
        const td = document.createElement('td'); td.textContent = value; tr.append(td);
      }
      const feedbackCell = document.createElement('td');
      const feedback = document.createElement('span'); feedback.className = 'history-feedback';
      feedback.textContent = row.alertedArm === 'L' ? 'Left arm alerted' : row.alertedArm === 'R' ? 'Right arm alerted' : row.alertedArm === 'None' ? 'No feedback' : 'Not reported';
      feedback.dataset.active = String(row.alertedArm === 'L' || row.alertedArm === 'R');
      feedbackCell.append(feedback); tr.append(feedbackCell);
      $('history-rows').append(tr);
    }
    $('history-status').textContent = historyRows.length
      ? `Showing ${historyRows.length} saved summaries${historyBeforeId !== null ? '; more rows available' : ''}. Load logs to refresh; CSV includes the entire selected date.`
      : 'No saved summaries for this date. New summaries appear after an online board completes a 10-second window.';
  } catch (error) {
    if (epoch !== sessionEpoch || error.name === 'SessionChangedError') return;
    if (!api.authenticated) clearSession();
    $('history-status').textContent = `Logs unavailable: ${error.message}`;
  } finally {
    if (epoch === sessionEpoch) { historyBusy = false; renderHistoryControls(); }
  }
}

async function downloadHistory() {
  if (!api?.authenticated || historyBusy || historyExporting) return;
  const epoch = sessionEpoch;
  historyExporting = true; renderHistoryControls();
  $('history-status').textContent = 'Preparing CSV…';
  try {
    const result = await api.exportMeasurements(historyRange(), count => {
      if (epoch === sessionEpoch) $('history-status').textContent = `Preparing CSV · ${count} summaries…`;
    });
    if (epoch !== sessionEpoch) return;
    if (!result.count) { $('history-status').textContent = 'No saved summaries for this date.'; return; }
    const url = URL.createObjectURL(new Blob([result.csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url;
    link.download = `blindbalance-summaries-${$('history-date').value}.csv`;
    document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    $('history-status').textContent = `${result.count} saved summaries exported. Download handed to your browser.`;
  } catch (error) {
    if (epoch !== sessionEpoch || error.name === 'SessionChangedError') return;
    if (!api.authenticated) clearSession();
    $('history-status').textContent = `Export unavailable: ${error.message}`;
  } finally {
    if (epoch === sessionEpoch) { historyExporting = false; renderHistoryControls(); }
  }
}

function renderActivity(state) {
  const list = $('commands');
  // Rebuild only when data changes; the periodic heartbeat-age render preserves focus.
  const key = JSON.stringify(state.commands.map(command => [command.id, command.outcome, command.value]));
  if (list.dataset.key === key) return;
  list.dataset.key = key;
  list.replaceChildren();
  if (!state.commands.length) { const li = document.createElement('li'); li.textContent = 'No recent commands.'; list.append(li); }
  for (const command of state.commands) {
    const li = document.createElement('li');
    const details = document.createElement('div');
    details.textContent = `${actionNames[command.action] || command.action}${command.value !== undefined ? ` → ${command.value}` : ''} · ${command.target === 'pair' ? 'both arms' : command.target + ' arm'}`;
    const sub = document.createElement('small');
    sub.textContent = `Revision ${command.revision} · ${Object.entries(command.outcome.arms).map(([arm, result]) => `${arm}: ${result}`).join(' · ')} · ${command.id}`;
    details.append(sub);
    const badge = document.createElement('span'); badge.className = 'badge';
    badge.textContent = ({ partial: 'Partially applied', unknown: 'Outcome unknown', pending: 'Pending', applied: 'Applied', expired: 'Expired', failed: 'Failed' })[command.outcome.state] || 'Outcome unknown';
    if (['unknown', 'failed', 'expired'].includes(command.outcome.state)) badge.dataset.tone = 'stale';
    li.append(details, badge); list.append(li);
  }
}

function renderCaptures() {
  const captures = snapshot?.captures || [];
  const key = JSON.stringify(captures);
  if ($('captures').dataset.key === key) return;
  $('captures').dataset.key = key;
  $('captures').replaceChildren();
  if (!captures.length) { const li = document.createElement('li'); li.textContent = 'No verified uploads yet.'; $('captures').append(li); }
  for (const capture of captures) {
    const li = document.createElement('li');
    const detail = document.createElement('div');
    const device = snapshot.devices.find(item => item.id === capture.deviceId);
    detail.textContent = `${device?.arm || capture.deviceId} · ${capture.captureId}`;
    const sub = document.createElement('small'); sub.textContent = `${numberText(capture.bytes, ' bytes')} · SHA-256 ${capture.sha256}`; detail.append(sub);
    const button = document.createElement('button'); button.type = 'button'; button.className = 'secondary'; button.textContent = 'Download CSV';
    button.setAttribute('aria-label', `Download capture ${capture.captureId}`);
    button.addEventListener('click', () => void download(capture));
    li.append(detail, button); $('captures').append(li);
  }
}

function clearSession() {
  sessionEpoch++;
  api?.signOut(); snapshot = null; pendingReceipt = null; connected = false; submitting = false;
  historyInitialized = false; historyBusy = false; historyExporting = false;
  historyRows = []; historyBeforeId = null; $('history-rows').replaceChildren();
  $('history-status').textContent = 'Choose a date to view saved summaries.';
  $('access-key').value = '';
  render();
}

async function refresh() {
  if (!api?.authenticated || refreshing) return false;
  const epoch = sessionEpoch;
  const requestAt = performance.now();
  refreshing = true;
  try {
    const next = await api.state();
    if (epoch !== sessionEpoch) return false;
    if (!Number.isFinite(next.serverTimeMs) || !Number.isSafeInteger(next.revision) || !Array.isArray(next.devices) || !Array.isArray(next.commands) || !Array.isArray(next.captures)) throw new Error('The backend returned an invalid state.');
    snapshot = next; snapshotAt = requestAt; connected = true;
    if (!historyInitialized) {
      historyInitialized = true;
      const today = new Date();
      $('history-date').value = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      void loadHistory();
    }
    if (pendingReceipt && (pendingReceipt.id ? next.commands.some(command => command.id === pendingReceipt.id) : next.revision > pendingReceipt.baseline)) pendingReceipt = null;
    return true;
  } catch (error) {
    if (epoch !== sessionEpoch || error.name === 'SessionChangedError') return false;
    connected = false;
    if (!api.authenticated) clearSession();
    message(error.status === 401 || error.status === 403 ? error.message : 'Could not refresh state. Controls are paused; reported values may be out of date.', true);
    return false;
  } finally { refreshing = false; render(); }
}

async function submit(action, target, value) {
  let payload;
  try { payload = commandPayload(currentState(), action, target, value); } catch (error) { message(error.message, true); return; }
  if (action === 'raw_clear' && !window.confirm(`Clear the stopped LOCAL capture ${payload.captureId} on the ${target} arm? A verified cloud copy, if present, will remain. An unuploaded capture will be lost.`)) return;
  const epoch = sessionEpoch;
  submitting = true;
  pendingReceipt = { baseline: payload.expectedRevision };
  message('Submitting command. Waiting for device confirmation.'); render();
  try {
    const accepted = await api.command(payload);
    if (epoch !== sessionEpoch) return;
    if (typeof accepted.id !== 'string' || !Number.isSafeInteger(accepted.revision)) throw new Error('Invalid command receipt.');
    pendingReceipt = { ...pendingReceipt, id: accepted.id, baseline: payload.expectedRevision };
    message(`Command accepted at revision ${accepted.revision}. Check per-arm results below; application is not yet confirmed.`);
  } catch (error) {
    if (epoch !== sessionEpoch || error.name === 'SessionChangedError') return;
    if (!api.authenticated) { clearSession(); message(error.message, true); }
    else if ([400, 409, 503].includes(error.status)) { pendingReceipt = null; connected = false; message(`Command not accepted: ${error.message} Refreshing the latest state.`, true); }
    else message('Submission outcome unknown. It will not be retried automatically. Controls stay paused until the backend reports a newer command; check the devices before reconnecting.', true);
  } finally {
    if (epoch === sessionEpoch) { submitting = false; render(); await refresh(); }
  }
}

async function download(capture) {
  const epoch = sessionEpoch;
  message('Downloading the verified capture…');
  try {
    const blob = await api.download(capture.deviceId, capture.captureId);
    if (epoch !== sessionEpoch) return;
    if (blob.size !== capture.bytes) throw new Error('The download size did not match the verified capture.');
    const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
    if (epoch !== sessionEpoch) return;
    const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    if (hash !== capture.sha256) throw new Error('The download checksum did not match the verified capture.');
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = url;
    link.download = `blindbalance-${capture.deviceId}-${capture.captureId}.csv`.replace(/[^a-zA-Z0-9_.-]/g, '_');
    document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    message('Capture verified. Download handed to your browser.');
  } catch (error) {
    if (epoch !== sessionEpoch || error.name === 'SessionChangedError') return;
    if (!api.authenticated) clearSession();
    message(`Download unavailable: ${error.message}`, true);
  }
}

$('login-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (!api || refreshing) return;
  try {
    api.signIn($('access-key').value); $('access-key').value = ''; $('sign-in').disabled = true;
    message('Checking your access…');
    if (await refresh()) message('Connected. Values below are device-reported; commands require confirmation.');
    else if (!snapshot) api.signOut();
  } catch (error) { message(error.message, true); }
  finally { $('sign-in').disabled = !api; render(); }
});
$('sign-out').addEventListener('click', () => { clearSession(); message('Signed out. Your access key and private state have been cleared from this page.'); $('access-key').focus(); });
$('refresh').addEventListener('click', () => void refresh());
$('history-form').addEventListener('submit', event => { event.preventDefault(); void loadHistory(); });
$('history-date').addEventListener('change', () => void loadHistory());
$('history-more').addEventListener('click', () => void loadHistory(true));
$('history-download').addEventListener('click', () => void downloadHistory());
$('feedback-on').addEventListener('click', () => void submit('set_motor_enabled', 'pair', true));
$('feedback-off').addEventListener('click', () => void submit('set_motor_enabled', 'pair', false));
$('sensitivity-form').addEventListener('submit', event => { event.preventDefault(); void submit('set_sensitivity', 'pair', $('sensitivity').value); });
document.addEventListener('visibilitychange', () => { render(); if (!document.hidden) void refresh(); });
window.addEventListener('pagehide', () => clearSession());

try { api = new ControlApi(API_BASE_URL); }
catch {
  $('configuration').hidden = false;
  $('configuration').textContent = 'Hosted control is not configured yet. An administrator must provision the Cloudflare backend and set the public HTTPS API URL before operator sign-in is available.';
  $('sign-in').disabled = true; $('access-key').disabled = true;
  message('Device controls are unavailable until backend setup is complete.');
}
render();
setInterval(() => { if (!document.hidden) void refresh(); }, 2000);
setInterval(() => { if (!document.hidden) render(); }, 1000);
