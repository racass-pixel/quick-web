import { createClient } from '@connectrpc/connect';
import { Auth } from '@racass-pixel/quick-protocol';
import { transport } from './transport';

export const authClient = createClient(Auth, transport);
