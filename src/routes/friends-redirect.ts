// Deprecated /friends routes — bounce to /chats. Kept as catch-all routes so
// stale bookmarks / external links don't 404.

import { createRoute, redirect } from '@tanstack/react-router';
import { Route as RootRoute } from './__root';

function bounce(): never {
  throw redirect({ to: '/chats' });
}

export const FriendsRedirectRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: '/friends',
  beforeLoad: bounce,
  component: () => null,
});

export const FriendsSplatRedirectRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: '/friends/$',
  beforeLoad: bounce,
  component: () => null,
});
