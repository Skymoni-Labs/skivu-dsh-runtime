// Local inherited-descriptor transport. The host owns all authority.
import { Socket } from 'node:net';

const requestLimit = process.env.SKIVU_LARGE_MODEL_FRAMES === '1' ? 4 * 1024 * 1024 : 256 * 1024;
const responseLimit = 8 * 1024 * 1024;

export class ModelClient {
  constructor(stream) {
    this.stream = stream;
    this.parts = []; this.length = 0;
    this.serial = 0;
    this.pending = null;
    this.closed = false;
    stream.on('data', chunk => this.receive(chunk));
    stream.on('error', () => this.close('BROKER_DISCONNECTED'));
    stream.on('close', () => this.close('BROKER_DISCONNECTED'));
  }
  static fromFd(fd) {
    if (!Number.isSafeInteger(fd) || fd < 3) throw new Error('Invalid host-provided descriptor');
    return new ModelClient(new Socket({ fd, readable: true, writable: true }));
  }
  receive(chunk) {
    if (this.closed) return;
    let offset = 0;
    while (offset < chunk.length) {
      const end = chunk.indexOf(10, offset);
      const next = end < 0 ? chunk.length : end;
      const part = chunk.subarray(offset, next);
      if (this.length + part.length > responseLimit || this.parts.length >= 65536) return this.close('INVALID_RESPONSE');
      if (part.length) { this.parts.push(part); this.length += part.length; }
      if (end < 0) return;
      const line = Buffer.concat(this.parts, this.length); this.parts = []; this.length = 0; offset = end + 1;
      let reply;
      try { reply = JSON.parse(line.toString('utf8')); } catch { return this.close('INVALID_RESPONSE'); }
      if (!reply || typeof reply.id !== 'string' || typeof reply.ok !== 'boolean' || !this.pending || reply.id !== this.pending.id) return this.close('INVALID_RESPONSE');
      const pending = this.pending; this.pending = null; pending.finish();
      if (reply.ok) pending.resolve(reply.result);
      else {
        const error = new Error(typeof reply.error?.message === 'string' ? reply.error.message : 'Model request failed');
        error.code = typeof reply.error?.code === 'string' ? reply.error.code : 'OPERATION_FAILED';
        pending.reject(error);
      }
    }
  }
  generate(params, signal) {
    const keys = params && typeof params === 'object' && !Array.isArray(params) ? Object.keys(params).sort().join(',') : '';
    if (!['messages,tools','messages,model,tools'].includes(keys) || ('model' in params && (typeof params.model !== 'string' || params.model.length > 512))) return Promise.reject(new Error('Invalid model parameters'));
    return this.request('model.generate',params,signal);
  }
  models() { return this.request('model.list',{}); }
  request(method, params, signal) {
    if (this.closed) return Promise.reject(new Error('Model broker closed'));
    if (signal?.aborted) return Promise.reject(new Error('Model request cancelled'));
    if (this.pending) return Promise.reject(new Error('Model broker busy'));
    if (this.serial >= 4096) return Promise.reject(new Error('Model broker request limit reached'));
    const id = String(++this.serial);
    let body;
    try { body = JSON.stringify({ id, method, params }) + '\n'; } catch { return Promise.reject(new Error('Invalid model parameters')); }
    if (Buffer.byteLength(body) > requestLimit) return Promise.reject(new Error('Model request too large'));
    return new Promise((resolve, reject) => {
      const abort = () => this.close('Model request cancelled');
      const timer = setTimeout(() => this.close('Model request timed out'), 600000);
      const finish = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); };
      this.pending = { id, resolve, reject, finish };
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) return abort();
      try { this.stream.write(body, error => { if (error) this.close('BROKER_DISCONNECTED'); }); }
      catch { this.close('BROKER_DISCONNECTED'); }
    });
  }
  close(reason = 'BROKER_CLOSED') {
    if (this.closed) return;
    this.closed = true;
    if (this.pending) { const pending = this.pending; this.pending = null; pending.finish(); pending.reject(new Error(reason)); }
    this.stream.destroy();
  }
}
