import type { ReactNode } from 'react';

export function Kicker({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`kicker mb-3 ${className}`}>{children}</div>;
}
