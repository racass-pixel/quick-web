import { Outlet, createRootRoute } from '@tanstack/react-router';
import { useEffect } from 'react';
import { ws } from '../api/ws';
import { session } from '../api/session';
import { useCall } from '../stores/useCall';
import { useGroupCall } from '../stores/useGroupCall';
import { IncomingCallModal } from '../components/call/IncomingCallModal';
import { CallView } from '../components/call/CallView';
import { ProfileModal } from '../components/profile/ProfileModal';

function RootLayout() {
  // Keep the realtime socket open across every authenticated route so the
  // incoming-call modal can appear regardless of which page the user is on.
  // Previously ws.connect() only ran on /chats* — a user sitting on /settings
  // or anywhere else would miss the incoming envelope entirely.
  useEffect(() => {
    if (session.token) ws.connect();
    const off = session.subscribe(() => {
      if (session.token) ws.connect();
      else ws.disconnect();
    });
    return () => {
      off();
    };
  }, []);

  // Forward every realtime envelope to both call stores. 1:1 envelopes
  // (incoming_call / call_accepted / call_declined / call_ended) drive the
  // useCall state machine; group envelopes (group_call_started / joined /
  // left / ended) drive useGroupCall. Each store ignores envelopes it
  // doesn't recognise.
  useEffect(() => {
    const unsubscribe = ws.subscribe((env) => {
      useCall.getState().onIncomingCallEnvelope(env);
      useGroupCall.getState().onWsEnvelope(env);
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
      {/* Profile card overlay — opened from any avatar across the app. */}
      <ProfileModal />
    </div>
  );
}

export const Route = createRootRoute({
  component: RootLayout,
});
