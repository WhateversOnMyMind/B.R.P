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
  command(payload) { return this.#request('/v1/operator/commands', { method: 'POST', body: payload }); }
  download(deviceId, captureId) {
    return this.#request(`/v1/operator/captures/${encodeURIComponent(deviceId)}/${encodeURIComponent(captureId)}`, { blob: true });
  }
}
