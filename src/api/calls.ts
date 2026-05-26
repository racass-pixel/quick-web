import { createClient } from '@connectrpc/connect';
import { Calls } from '@racass-pixel/quick-protocol';
import { transport } from './transport';

// Connect client for the Calls service. Bearer auth is injected by the
// shared transport interceptor, so callers can invoke methods directly.
//
// Exposes:
//   1:1 calls   — startCall / acceptCall / declineCall / endCall (S5).
//   Group calls — startGroupCall / joinGroupCall / leaveGroupCall /
//                 endGroupCall / listActiveGroupCalls (S9, quick-protocol
//                 v0.8.0). Group calls are Telegram-style: no ring, free
//                 join while the room is open.
export const callsClient = createClient(Calls, transport);
