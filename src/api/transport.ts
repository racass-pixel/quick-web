import { createConnectTransport } from '@connectrpc/connect-web';

const baseUrl = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:8080';

export const transport = createConnectTransport({
  baseUrl,
  useBinaryFormat: false,
});
