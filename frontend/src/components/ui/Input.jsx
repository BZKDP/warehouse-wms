import { cn } from '../../utils/cn';
import { forwardRef } from 'react';

const Input = forwardRef(function Input({
  label,
  error,
  hint,
  icon,
  iconRight,
  className,
  containerClass,
  ...props
}, ref) {
  return (
    <div className={cn('flex flex-col gap-1.5', containerClass)}>
      {label && (
        <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
          {label}
        </label>
      )}
      <div className="relative">
        {icon && (
          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4">
            {icon}
          </div>
        )}
        <input
          ref={ref}
          className={cn(
            'w-full rounded-xl border bg-white px-4 py-2.5 text-sm text-gray-900',
            'placeholder:text-gray-400',
            'border-gray-200 focus:border-primary-400 focus:ring-2 focus:ring-primary-100 focus:outline-none',
            'disabled:bg-gray-50 disabled:text-gray-400 disabled:cursor-not-allowed',
            'transition-all duration-150',
            'dark:bg-gray-800 dark:border-gray-700 dark:text-gray-100 dark:placeholder:text-gray-500',
            icon && 'pl-10',
            iconRight && 'pr-10',
            error && 'border-rose-300 focus:border-rose-400 focus:ring-rose-100',
            className
          )}
          {...props}
        />
        {iconRight && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4">
            {iconRight}
          </div>
        )}
      </div>
      {error && <p className="text-xs text-rose-500">{error}</p>}
      {hint && !error && <p className="text-xs text-gray-400">{hint}</p>}
    </div>
  );
});

export default Input;
