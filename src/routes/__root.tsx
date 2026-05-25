import { Outlet, createRootRoute } from '@tanstack/react-router';
import { useEffect } from 'react';
import { ws } from '../api/ws';
import { useCall } from '../stores/useCall';
import { IncomingCallModal } from '../components/call/IncomingCallModal';
import { CallView } from '../components/call/CallView';

function RootLayout() {
  // Forward every realtime envelope to the call store. Call-shaped envelopes
  // (incoming_call / call_accepted / call_declined / call_ended) drive its
  // state machine; everything else is ignored.
  useEffect(() => {
    const unsubscribe = ws.subscribe((env) => {
      useCall.getState().onIncomingCallEnvelope(env);
    });
    return () => {
      unsubscribe();
    };
  }, []);

  return (
    <div className="min-h-screen bg-bg text-ink-1">
      <Outlet />
      {/* Call overlays render above whatever route is mounted. */}
      <IncomingCallModal />
      <CallView />
    </div>
  );
}

export const Route = createRootRoute({
  component: RootLayout,
});
