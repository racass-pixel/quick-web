import { createClient } from '@connectrpc/connect';
import { Friends } from '@racass-pixel/quick-protocol';
import { transport } from './transport';

export const friendsClient = createClient(Friends, transport);
