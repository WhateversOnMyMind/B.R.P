export function validateApiBase(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Hosted control is not configured.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash ||
      /(^localhost$|\.localhost$|\.local$|^127\.|^0\.0\.0\.0$|^\[::1\]$)/i.test(url.hostname)) {
    throw new Error('Configure an HTTPS hosted API URL without credentials, query parameters, or a local hostname.');
  }
  return url.href.replace(/\/+$/, '');
}

export class ControlApi {
  #key = '';
  #generation = 0;
  constructor(base, fetcher = globalThis.fetch.bind(globalThis)) {
    this.base = validateApiBase(base);
    this.fetcher = fetcher;
  }
  get authenticated() { return Boolean(this.#key); }
  signIn(key) {
    if (typeof key !== 'string' || !key.trim() || /\s/.test(key.trim())) throw new Error('Enter your operator access key.');
    this.#key = key.trim();
    this.#generation++;
  }
  signOut() { this.#key = ''; this.#generation++; }
  async #request(path, { method = 'GET', body, blob = false } = {}) {
    if (!this.authenticated) throw Object.assign(new Error('Sign in to continue.'), { status: 401 });
    const generation = this.#generation;
    const response = await this.fetcher(this.base + path, {
      method, headers: { Authorization: `Bearer ${this.#key}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}), credentials: 'omit', cache: 'no-store', redirect: 'error',
      signal: AbortSignal.timeout(8000)
    });
    const ensureCurrent = () => {
      if (generation !== this.#generation) throw Object.assign(new Error('Session changed.'), { name: 'SessionChangedError' });
    };
    ensureCurrent();
    if (response.status === 401 || response.status === 403) {
      this.signOut();
      throw Object.assign(new Error('Access expired or was denied. Sign in with an authorized operator key.'), { status: response.status });
    }
    if (!response.ok) {
      const detail = await response.json().catch(() => ({}));
      ensureCurrent();
      throw Object.assign(new Error(typeof detail.error === 'string' ? detail.error.slice(0, 240) : `Request failed (${response.status}).`), { status: response.status });
    }
    const result = blob ? await response.blob() : await response.json();
    ensureCurrent();
    return result;
  }
  state() { return this.#request('/v1/operator/state'); }
  measurements({fromMs,toMs,limit=100,beforeId}={}) {
    const query=new URLSearchParams({fromMs,toMs,limit});
    if(beforeId!==undefined) query.set('beforeId',beforeId);
    return this.#request('/v1/operator/measurements?'+query);
  }
  async exportMeasurements({fromMs,toMs,limit=1000},onProgress=()=>{}) {
    const generation=this.#generation;
    const ensureCurrent=()=> {
      if(generation!==this.#generation) throw Object.assign(new Error('Session changed.'),{name:'SessionChangedError'});
    };
    const lines=['Received At (UTC),Arm,Count,Distance(cm),Alerted Arm,Device,Boot ID,Window Sequence,Window Start(ms since boot),Window End(ms since boot),Window Late(ms),Missed Deadlines'];
    const cell=value=> {
      let text=String(value??'');
      if(typeof value==='string'&&/^[=+@\-\t\r]/.test(text)) text="'"+text;
      return /[,"\r\n]/.test(text)?'"'+text.replaceAll('"','""')+'"':text;
    };
    let beforeId,count=0;
    do {
      ensureCurrent();
      const page=await this.measurements({fromMs,toMs,limit,beforeId});
      ensureCurrent();
      if(!Array.isArray(page.records)||!(page.nextBeforeId===null||Number.isSafeInteger(page.nextBeforeId)&&page.nextBeforeId>0&&page.records.length>0&&(beforeId===undefined||page.nextBeforeId<beforeId))) throw new Error('Invalid history page. Export cancelled.');
      onProgress(count+page.records.length); ensureCurrent();
      for(const r of page.records) lines.push([new Date(r.receivedMs).toISOString(),r.arm,r.count,r.distanceCm,r.alertedArm,r.deviceId,r.bootId,r.windowSequence,r.windowStartMs,r.windowEndMs,r.windowLateMs,r.windowMissedDeadlines].map(cell).join(','));
      count+=page.records.length;
      beforeId=page.nextBeforeId;
    } while(beforeId!==null);
    return {count,csv:lines.join('\r\n')+'\r\n'};
  }
  command(payload) { return this.#request('/v1/operator/commands', { method: 'POST', body: payload }); }
  download(deviceId, captureId) {
    return this.#request(`/v1/operator/captures/${encodeURIComponent(deviceId)}/${encodeURIComponent(captureId)}`, { blob: true });
  }
}
