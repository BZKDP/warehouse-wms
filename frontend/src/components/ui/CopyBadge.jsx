import { useState } from 'react';
import { Copy, Check } from 'lucide-react';

function copyToClipboard(text) {
  // execCommand first — works on HTTP without Secure Context
  try {
    const el = document.createElement('textarea');
    el.value = text;
    el.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0';
    document.body.appendChild(el);
    el.focus();
    el.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(el);
    if (ok) return Promise.resolve();
  } catch {}
  // Fallback to Clipboard API (works on HTTPS / localhost)
  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    return navigator.clipboard.writeText(text);
  }
  return Promise.reject(new Error('Copy failed'));
}

const VARIANTS = {
  default: 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-primary-50 hover:text-primary-700 hover:border-primary-200',
  ghost: 'bg-transparent text-inherit hover:bg-white/30 hover:text-inherit',
  primary: 'bg-primary-100/50 text-primary-700 hover:bg-primary-100 hover:border-primary-200',
  blue: 'bg-blue-100/50 text-blue-700 hover:bg-blue-100 hover:border-blue-200',
  green: 'bg-green-100/50 text-green-700 hover:bg-green-100 hover:border-green-200',
  amber: 'bg-amber-100/50 text-amber-700 hover:bg-amber-100 hover:border-amber-200',
};

export default function CopyBadge({ value, label, className = '', variant = 'default' }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = (e) => {
    e.stopPropagation();
    e.preventDefault();
    if (!value) return;
    copyToClipboard(String(value)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      title={`Скопировать: ${value}`}
      aria-label={`Скопировать ${value}`}
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-mono
        border border-transparent transition-all cursor-pointer select-none active:scale-95
        ${VARIANTS[variant] || VARIANTS.default} ${className}`}
    >
      {copied ? (
        <>
          <Check size={10} className="text-green-500 flex-shrink-0" />
          <span className="text-green-600 dark:text-green-400 font-sans font-medium">Скопировано</span>
        </>
      ) : (
        <>
          <Copy size={10} className="opacity-50 flex-shrink-0" />
          <span>{label !== undefined ? label : value}</span>
        </>
      )}
    </button>
  );
}

export { copyToClipboard };
