import { Outlet, createRootRoute } from '@tanstack/react-router';

function RootLayout() {
  return (
    <div className="min-h-screen bg-bg text-ink-1">
      <Outlet />
    </div>
  );
}

export const Route = createRootRoute({
  component: RootLayout,
});
