// Development-only DSH tools. The host remains the sole device-task owner.
import { defineTool } from '@deepseek-ai/dsh-tools';
import { DeviceClient } from './client.mjs';

export const name = 'skivu-device-tools';
export const inject = ['tools'];

const text = value => [{ type: 'text', text: JSON.stringify(value.result) }];
const output = {
  schema: { type: 'object', additionalProperties: false, properties: { result: { type: 'json', required: true } } },
  render: (_args, value) => text(value),
};

export function createTools(client) {
  function tool(name, description, parameters, method, makeParams) {
    return defineTool({
      name, description, parameters, output,
      async execute(args, execution) {
        const result = await client.call(method, makeParams(args), execution?.signal);
        if (method === 'agent.tasks.start' && execution?.signal?.aborted && typeof result?.taskId === 'string') {
          // A task may already have started even though the enclosing DSH call
          // was cancelled. Reconcile by asking the host to stop the task.
          await client.call('agent.tasks.cancel', { taskId: result.taskId });
          throw new Error('Device task cancellation requested; inspect its final state');
        }
        return { result: result ?? null };
      },
    });
  }
  return [
    tool('skivu_phone_discover', 'List locally available Android device companions. Pairing still requires user approval.', {}, 'device.discover', () => ({})),
    tool('skivu_phone_connect', 'Connect a user-selected device companion by component. The phone must approve the caller.', {
      component: { type: 'string', required: true, description: 'Component returned by discovery.' },
      signerSha256: { type: 'string', description: 'Previously verified companion signer fingerprint.' },
    }, 'device.connect', args => ({ component: args.component, ...(args.signerSha256 ? { signerSha256: args.signerSha256 } : {}) })),
    tool('skivu_phone_apps', 'List launchable apps for an approved connection.', {
      connectionId: { type: 'string', required: true, description: 'Connection ID returned by connect.' },
    }, 'device.apps', args => ({ connectionId: args.connectionId })),
    tool('skivu_phone_start', 'Start a bounded phone task in explicitly selected Android applications. The host uses its authorized model and device companion, and the user can stop the task.', {
      connectionId: { type: 'string', required: true, description: 'Approved connection ID.' },
      goal: { type: 'string', required: true, description: 'The user-requested device task.' },
      allowedPackages: { type: 'json', required: true, description: 'Array of exact Android package names allowed for this task.' },
    }, 'agent.tasks.start', args => ({ connectionId: args.connectionId, goal: args.goal, allowedPackages: args.allowedPackages })),
    tool('skivu_phone_status', 'Get the state and outcome of a previously started task.', {
      taskId: { type: 'string', required: true, description: 'Task ID returned by start.' },
    }, 'agent.tasks.get', args => ({ taskId: args.taskId })),
    tool('skivu_phone_cancel', 'Stop a previously started phone task.', {
      taskId: { type: 'string', required: true, description: 'Task ID returned by start.' },
    }, 'agent.tasks.cancel', args => ({ taskId: args.taskId })),
  ];
}

export function apply(ctx) {
  const raw = process.env.SKIVU_DEVICE_BROKER_FD;
  if (!raw || !/^[0-9]+$/.test(raw)) throw new Error('Skivu device broker was not provided');
  const client = DeviceClient.fromFd(Number(raw));
  for (const tool of createTools(client)) ctx.tools.register(tool);
  ctx.effect(() => () => client.close());
}
