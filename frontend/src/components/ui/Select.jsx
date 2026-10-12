import { cn } from '../../utils/cn';

export default function Select({ label, error, className, containerClass, children, ...props }) {
  return (
    <div className={cn('flex flex-col gap-1.5', containerClass)}>
      {label && (
        <label className="text-sm font-medium text-gray-700 dark:text-gray-300">{label}</label>
      )}
      <select
        className={cn(
          'w-full rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm text-gray-900',
          'focus:border-primary-400 focus:ring-2 focus:ring-primary-100 focus:outline-none',
          'disabled:bg-gray-50 disabled:cursor-not-allowed transition-all duration-150',
          'dark:bg-gray-800 dark:border-gray-700 dark:text-gray-100',
          error && 'border-rose-300',
          className
        )}
        {...props}
      >
        {children}
      </select>
      {error && <p className="text-xs text-rose-500">{error}</p>}
    </div>
  );
}
