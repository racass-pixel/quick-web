import { createClient } from '@connectrpc/connect';
import { Messaging } from '@racass-pixel/quick-protocol';
import { transport } from './transport';

export const messagingClient = createClient(Messaging, transport);
