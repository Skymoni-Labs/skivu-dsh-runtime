// Development-only transport; the host supplies an already-open local FD.
import { Socket } from 'node:net';

export const methods = new Set([
  'device.discover', 'device.connect', 'device.status', 'device.apps',
  'device.openCompanion', 'device.disconnect', 'agent.tasks.start',
  'agent.tasks.get', 'agent.tasks.cancel',
]);
const limit = 64 * 1024;

export class DeviceClient {
  constructor(stream) {
    this.stream = stream;
    this.parts = [];
    this.length = 0;
    this.pending = new Map();
    this.sequence = 0;
    this.closed = false;
    stream.on('data', chunk => this.receive(chunk));
    stream.on('error', () => this.close('BROKER_DISCONNECTED'));
    stream.on('close', () => this.close('BROKER_DISCONNECTED'));
  }
  static fromFd(fd) {
    if (!Number.isSafeInteger(fd) || fd < 3) throw new Error('Invalid host-provided descriptor');
    return new DeviceClient(new Socket({ fd, readable: true, writable: true }));
  }
  receive(chunk) {
    if (this.closed) return;
    let offset = 0;
    while (offset < chunk.length) {
      const end = chunk.indexOf(10, offset);
      const next = end < 0 ? chunk.length : end;
      const part = chunk.subarray(offset, next);
      if (this.length + part.length > limit || this.parts.length >= 65536) return this.close('INVALID_RESPONSE');
      if (part.length) { this.parts.push(part); this.length += part.length; }
      if (end < 0) return;
      const line = Buffer.concat(this.parts, this.length);
      this.parts = [];
      this.length = 0;
      offset = end + 1;
      let response;
      try { response = JSON.parse(line.toString('utf8')); } catch { return this.close('INVALID_RESPONSE'); }
      if (!response || typeof response.id !== 'string' || typeof response.ok !== 'boolean') return this.close('INVALID_RESPONSE');
      const pending = this.pending.get(response.id);
      if (!pending) continue;
      this.pending.delete(response.id);
      pending.finish();
      if (response.ok) pending.resolve(response.result);
      else {
        const error = new Error(typeof response.error?.message === 'string' ? response.error.message : 'Device request failed');
        error.code = typeof response.error?.code === 'string' ? response.error.code : 'OPERATION_FAILED';
        pending.reject(error);
      }
    }
  }
  call(method, params = {}, signal) {
    if (!methods.has(method)) return Promise.reject(new Error('Unsupported device method'));
    if (this.closed) return Promise.reject(new Error('Device broker is closed'));
    if (signal?.aborted) return Promise.reject(new Error('Device request cancelled'));
    if (this.pending.size >= 8) return Promise.reject(new Error('Device broker is busy'));
    if (this.sequence >= 4096) return Promise.reject(new Error('Device broker request limit reached'));
    if (!params || typeof params !== 'object' || Array.isArray(params)) return Promise.reject(new Error('Invalid device parameters'));
    const id = String(++this.sequence);
    let body;
    try { body = JSON.stringify({ id, method, params }) + '\n'; }
    catch { return Promise.reject(new Error('Invalid device parameters')); }
    if (Buffer.byteLength(body) > limit) return Promise.reject(new Error('Device request too large'));
    return new Promise((resolve, reject) => {
      const finish = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); };
      const abort = () => { if (this.pending.delete(id)) { finish(); reject(new Error('Device request cancelled')); } };
      const timer = setTimeout(() => { if (this.pending.delete(id)) { finish(); reject(new Error('Device request timed out')); } }, 180000);
      this.pending.set(id, { resolve, reject, finish });
      // A dispatched start may already have side effects. Keep waiting for its
      // task ID even if the tool invocation is aborted; the caller can then
      // reconcile or explicitly cancel it. Do not claim that abort stopped it.
      if (method !== 'agent.tasks.start') signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) { abort(); return; }
      try {
        this.stream.write(body, error => {
          if (error && this.pending.delete(id)) { finish(); reject(new Error('Device broker disconnected')); }
        });
      } catch { if (this.pending.delete(id)) { finish(); reject(new Error('Device broker disconnected')); } }
    });
  }
  close(reason = 'BROKER_CLOSED') {
    if (this.closed) return;
    this.closed = true;
    for (const pending of this.pending.values()) { pending.finish(); pending.reject(new Error(reason)); }
    this.pending.clear();
    this.stream.destroy();
  }
}
