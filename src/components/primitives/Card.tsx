import type { HTMLAttributes, ReactNode } from 'react';

type Props = HTMLAttributes<HTMLDivElement> & {
  raised?: boolean;
  children: ReactNode;
};

export function Card({ raised = false, className = '', children, ...rest }: Props) {
  const surface = raised ? 'card-raised' : 'card';
  return (
    <div className={`${surface} p-6 ${className}`} {...rest}>
      {children}
    </div>
  );
}
