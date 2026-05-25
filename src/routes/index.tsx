import { createRoute, redirect } from '@tanstack/react-router';
import { Route as RootRoute } from './__root';
import { session } from '../api/session';

// Synchronous redirect based on whether a token is present.
// If a token is present we send to /friends; the friends loader is the
// definitive auth check (it will bounce back to /auth on a 401).
// If no token at all, straight to /auth.
export const Route = createRoute({
  getParentRoute: () => RootRoute,
  path: '/',
  beforeLoad: () => {
    if (session.token) throw redirect({ to: '/friends' });
    throw redirect({ to: '/auth' });
  },
  component: () => null,
});
