import { Route as RootRoute } from './__root';
import { Route as IndexRoute } from './index';
import { Route as AuthIndexRoute } from './auth/index';
import { Route as AuthCodeRoute } from './auth/code';
import { Route as AuthProfileRoute } from './auth/profile';
import { Route as ChatsIndexRoute } from './chats/index';
import { Route as ChatThreadRoute } from './chats/$id';
import { Route as SettingsRoute } from './settings';
import {
  FriendsRedirectRoute,
  FriendsSplatRedirectRoute,
} from './friends-redirect';

export const routeTree = RootRoute.addChildren([
  IndexRoute,
  AuthIndexRoute,
  AuthCodeRoute,
  AuthProfileRoute,
  ChatsIndexRoute,
  ChatThreadRoute,
  SettingsRoute,
  FriendsRedirectRoute,
  FriendsSplatRedirectRoute,
]);
