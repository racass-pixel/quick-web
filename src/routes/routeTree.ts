import { Route as RootRoute } from './__root';
import { Route as IndexRoute } from './index';
import { Route as AuthIndexRoute } from './auth/index';
import { Route as AuthCodeRoute } from './auth/code';
import { Route as AuthProfileRoute } from './auth/profile';
import { Route as FriendsIndexRoute } from './friends/index';
import { Route as FriendsAddRoute } from './friends/add';
import { Route as SettingsRoute } from './settings';

export const routeTree = RootRoute.addChildren([
  IndexRoute,
  AuthIndexRoute,
  AuthCodeRoute,
  AuthProfileRoute,
  FriendsIndexRoute,
  FriendsAddRoute,
  SettingsRoute,
]);
