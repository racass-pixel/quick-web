import { createClient } from '@connectrpc/connect';
import { Calls } from '@racass-pixel/quick-protocol';
import { transport } from './transport';

// Connect client for the Calls service. Bearer auth is injected by the
// shared transport interceptor, so callers can invoke methods directly.
export const callsClient = createClient(Calls, transport);
