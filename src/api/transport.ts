import { createConnectTransport } from '@connectrpc/connect-web';
import type { Interceptor } from '@connectrpc/connect';
import { session } from './session';

const baseUrl = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:8080';

const authInterceptor: Interceptor = (next) => async (req) => {
  const token = session.token;
  if (token) req.header.set('Authorization', `Bearer ${token}`);
  return next(req);
};

export const transport = createConnectTransport({
  baseUrl,
  useBinaryFormat: false,
  interceptors: [authInterceptor],
});
