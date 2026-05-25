import { forwardRef, type InputHTMLAttributes } from 'react';

type Props = InputHTMLAttributes<HTMLInputElement>;

export const Input = forwardRef<HTMLInputElement, Props>(function Input(
  { className = '', ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      className={
        'w-full bg-transparent text-ink-1 placeholder:text-ink-3 ' +
        'border-0 border-b border-line py-2 px-1 ' +
        'focus:outline-none focus:border-ember transition-colors ' +
        className
      }
      {...rest}
    />
  );
});
