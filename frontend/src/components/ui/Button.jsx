import { cn } from '../../utils/cn';

const variants = {
  // ─── Frosted Glass ─────────────────────────────────────────────
  primary: 'glass-btn text-primary-700 bg-primary-600/8 backdrop-blur-xl border border-primary-600/18 shadow-[0_2px_10px_rgba(124,58,237,0.12)] hover:bg-primary-600/14 hover:border-primary-600/28 hover:shadow-[0_5px_20px_rgba(124,58,237,0.12)] hover:-translate-y-px',
  secondary: 'glass-btn text-gray-700 bg-white/50 backdrop-blur-xl border border-white/75 shadow-xs hover:bg-white/70 hover:shadow-md hover:-translate-y-px',
  ghost: 'text-gray-400 bg-transparent border border-gray-200 hover:text-gray-700 hover:bg-white/50 hover:border-gray-300',
  danger: 'glass-btn text-rose-700 bg-rose-500/6 backdrop-blur-xl border border-rose-500/16 hover:bg-rose-500/12 hover:border-rose-500/26 hover:shadow-[0_5px_20px_rgba(225,29,72,0.1)] hover:-translate-y-px',
  outline: 'glass-btn text-gray-700 bg-white/50 backdrop-blur-xl border border-gray-200 hover:bg-white/70 hover:border-gray-300 hover:-translate-y-px',
  success: 'glass-btn text-green-700 bg-green-500/7 backdrop-blur-xl border border-green-500/18 hover:bg-green-500/13 hover:border-green-500/28 hover:shadow-[0_5px_20px_rgba(34,197,94,0.1)] hover:-translate-y-px',
  warning: 'glass-btn text-amber-700 bg-amber-500/7 backdrop-blur-xl border border-amber-500/18 hover:bg-amber-500/13 hover:border-amber-500/28 hover:shadow-[0_5px_20px_rgba(245,158,11,0.1)] hover:-translate-y-px',
  info: 'glass-btn text-blue-700 bg-blue-500/7 backdrop-blur-xl border border-blue-500/16 hover:bg-blue-500/13 hover:border-blue-500/26 hover:shadow-[0_5px_20px_rgba(59,130,246,0.1)] hover:-translate-y-px',
  cyan: 'glass-btn text-cyan-700 bg-cyan-500/7 backdrop-blur-xl border border-cyan-500/16 hover:bg-cyan-500/13 hover:border-cyan-500/26 hover:shadow-[0_5px_20px_rgba(8,145,178,0.1)] hover:-translate-y-px',

  // ─── Solid CTA (gradient + glass highlight) ────────────────────
  'primary-solid': 'glass-btn text-white bg-gradient-to-br from-primary-400 to-primary-600 border border-primary-600/30 shadow-[0_2px_12px_rgba(124,58,237,0.2)] hover:shadow-[0_6px_24px_rgba(124,58,237,0.3)] hover:-translate-y-px',
  'success-solid': 'glass-btn text-white bg-gradient-to-br from-emerald-400 to-green-600 border border-green-600/30 shadow-[0_2px_12px_rgba(34,197,94,0.2)] hover:shadow-[0_6px_24px_rgba(34,197,94,0.3)] hover:-translate-y-px',
  'danger-solid': 'glass-btn text-white bg-gradient-to-br from-rose-400 to-rose-600 border border-rose-600/30 shadow-[0_2px_12px_rgba(225,29,72,0.2)] hover:shadow-[0_6px_24px_rgba(225,29,72,0.3)] hover:-translate-y-px',
};

const sizes = {
  xs: 'px-2.5 py-1.5 text-xs rounded-lg gap-1',
  sm: 'px-3 py-1.5 text-[13px] rounded-xl gap-1.5',
  md: 'px-4 py-2.5 text-sm rounded-[14px]',
  lg: 'px-5 py-3 text-base rounded-[16px]',
  xl: 'px-6 py-3.5 text-base rounded-[18px]',
};

export default function Button({
  children,
  variant = 'primary',
  size = 'md',
  className,
  disabled,
  loading,
  icon,
  ...props
}) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center gap-2 font-medium transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-primary-500/30 focus:ring-offset-1 disabled:opacity-45 disabled:cursor-not-allowed disabled:transform-none select-none active:translate-y-0',
        variants[variant],
        sizes[size],
        className
      )}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? (
        <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      ) : icon ? (
        <span className="w-4 h-4">{icon}</span>
      ) : null}
      {children}
    </button>
  );
}
