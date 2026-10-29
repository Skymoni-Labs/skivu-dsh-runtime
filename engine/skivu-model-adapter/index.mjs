// SPDX-License-Identifier: GPL-3.0-only
// Host broker adapter. No credentials, endpoints, or billing choices cross
// this boundary; the supplied host client owns model selection and transport.
import { LlmAdapter, LlmError, ToolCallId } from '@deepseek-ai/dsh-llm';
import { ModelClient } from './client.mjs';

export const provider = 'skivu-current';
export const model = 'selected-in-skivu';
export const name = 'skivu-model-adapter';
export const inject = ['llm'];

function textBlocks(blocks) {
  const text = [];
  const calls = [];
  for (const block of blocks) {
    if (block.type === 'text') text.push(block.text);
    else if (block.type === 'tool-call') calls.push({ id: String(block.id), type: 'function', function: { name: block.name, arguments: block.arguments } });
    else throw new LlmError(`Skivu agent does not support ${block.type} content`, 'UNSUPPORTED_CONTENT');
  }
  return { text: text.join(''), calls };
}

export function serialize(options) {
  const messages = [];
  if (options.system) messages.push({ role: 'system', content: options.system });
  for (const source of options.messages) {
    const { text, calls } = textBlocks(source.content);
    if (source.role === 'tool') {
      if (calls.length || !source.toolCallId) throw new LlmError('Invalid tool result', 'INVALID_REQUEST');
      messages.push({ role: 'tool', tool_call_id: String(source.toolCallId), content: text });
    } else if (source.role === 'assistant') {
      messages.push({ role: 'assistant', content: text || (calls.length ? null : ''), ...(calls.length ? { tool_calls: calls } : {}) });
    } else if (source.role === 'user' || source.role === 'system' || source.role === 'developer') {
      if (calls.length) throw new LlmError('Invalid message tool calls', 'INVALID_REQUEST');
      messages.push({ role: source.role === 'developer' ? 'system' : source.role, content: text });
    } else throw new LlmError('Unsupported message role', 'INVALID_REQUEST');
  }
  const tools = (options.tools ?? []).map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));
  return { messages, tools };
}

export class SkivuModelAdapter extends LlmAdapter {
  constructor(client) { super(); this.client = client; }
  providerInfo(id) { return { id, name: 'Skivu 当前模型' }; }
  async listModels(id) { return [{ provider: id, id: model, name: '在 Skivu 中选择的模型', inputModalities: ['text'] }]; }
  async resolveModel(id, name) {
    if (id !== provider || name !== model) throw new LlmError('Select the Skivu model', 'UNKNOWN_MODEL');
    return { provider: id, id: model, name: '在 Skivu 中选择的模型', inputModalities: ['text'] };
  }
  async *stream(options) {
    if (options.provider !== provider || options.model !== model) throw new LlmError('Select the Skivu model', 'UNKNOWN_MODEL');
    options.signal?.throwIfAborted();
    const result = await this.client.generate(serialize(options), options.signal);
    options.signal?.throwIfAborted();
    const choice = result?.choices?.[0];
    const message = choice?.message;
    if (!message || !['stop', 'tool_calls', 'length'].includes(choice.finish_reason)) throw new LlmError('Invalid model response', 'INVALID_RESPONSE');
    if (message.tool_calls != null && !Array.isArray(message.tool_calls)) throw new LlmError('Invalid tool call response', 'INVALID_RESPONSE');
    const calls = message.tool_calls ?? [];
    if ((choice.finish_reason === 'tool_calls') !== (calls.length > 0)) throw new LlmError('Inconsistent tool call response', 'INVALID_RESPONSE');
    for (const call of calls) {
      if (call?.type !== 'function' || typeof call.id !== 'string' || typeof call.function?.name !== 'string' || typeof call.function?.arguments !== 'string') throw new LlmError('Invalid tool call response', 'INVALID_RESPONSE');
    }
    let index = 0;
    if (typeof message.content === 'string' && message.content.length) {
      const block = { type: 'text', text: message.content };
      yield { type: 'block-start', index, blockType: 'text' };
      yield { type: 'text-delta', index, text: block.text };
      yield { type: 'block-end', index: index++, block };
    }
    for (const call of calls) {
      const block = { type: 'tool-call', id: ToolCallId(call.id), name: call.function.name, arguments: call.function.arguments };
      yield { type: 'block-start', index, blockType: 'tool-call' };
      yield { type: 'tool-call-delta', index, id: block.id, name: block.name, argumentsDelta: block.arguments };
      yield { type: 'block-end', index: index++, block };
    }
    const usage = result.usage;
    if (Number.isSafeInteger(usage?.prompt_tokens) && Number.isSafeInteger(usage?.completion_tokens) && usage.prompt_tokens >= 0 && usage.completion_tokens >= 0) {
      const cached = Math.min(usage.prompt_tokens, Math.max(0, Number.isSafeInteger(usage.prompt_tokens_details?.cached_tokens) ? usage.prompt_tokens_details.cached_tokens : 0));
      yield { type: 'usage', usage: { inputTokens: usage.prompt_tokens - cached, outputTokens: usage.completion_tokens, ...(cached ? { cacheReadTokens: cached } : {}) } };
    }
    yield { type: 'finish', reason: { kind: choice.finish_reason === 'tool_calls' ? 'tool-calls' : choice.finish_reason === 'length' ? 'max-tokens' : 'stop' } };
  }
}

export function apply(ctx) {
  const raw = process.env.SKIVU_MODEL_BROKER_FD;
  if (!raw || !/^[0-9]+$/.test(raw)) throw new Error('Skivu model broker was not provided');
  const client = ModelClient.fromFd(Number(raw));
  try {
    ctx.llm.registerAdapter([provider], new SkivuModelAdapter(client));
    ctx.effect(() => () => client.close());
  } catch (error) { client.close(); throw error; }
}
