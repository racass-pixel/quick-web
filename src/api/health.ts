import { createClient } from '@connectrpc/connect';
import { Health } from '@racass-pixel/quick-protocol';
import { transport } from './transport';

export const healthClient = createClient(Health, transport);

export async function checkHealth() {
  return healthClient.check({});
}
