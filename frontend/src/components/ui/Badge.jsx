import { cn } from '../../utils/cn';

const variants = {
  default: 'bg-gray-100 text-gray-700',
  primary: 'bg-primary-100 text-primary-700',
  success: 'bg-green-100 text-green-700',
  warning: 'bg-amber-100 text-amber-700',
  danger: 'bg-rose-100 text-rose-700',
  info: 'bg-blue-100 text-blue-700',
  purple: 'bg-purple-100 text-purple-700',
  cyan: 'bg-cyan-100 text-cyan-700',
  orange: 'bg-orange-100 text-orange-700',
  // Marketplace brand badges
  wb: 'bg-[#cb11ab] text-white',
  ozon: 'bg-[#005bff] text-white',
  yandex: 'bg-[#ffcc00] text-gray-900',
  sber: 'bg-[#21a038] text-white',
};

export default function Badge({ children, variant = 'default', className, dot }) {
  return (
    <span className={cn(
      'inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium',
      variants[variant],
      className
    )}>
      {dot && <span className={cn('w-1.5 h-1.5 rounded-full', {
        'bg-gray-500': variant === 'default',
        'bg-primary-500': variant === 'primary',
        'bg-green-500': variant === 'success',
        'bg-amber-500': variant === 'warning',
        'bg-rose-500': variant === 'danger',
        'bg-blue-500': variant === 'info',
        'bg-cyan-500': variant === 'cyan',
        'bg-orange-500': variant === 'orange',
      })} />}
      {children}
    </span>
  );
}
