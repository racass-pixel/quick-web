import { createClient } from '@connectrpc/connect';
import { Users } from '@racass-pixel/quick-protocol';
import { transport } from './transport';

export const usersClient = createClient(Users, transport);
