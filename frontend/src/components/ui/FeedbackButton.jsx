import { useState } from 'react';
import { MessageSquarePlus } from 'lucide-react';
import FeedbackModal from '../feedback/FeedbackModal';

export default function FeedbackButton({ position = 'admin' }) {
  const [open, setOpen] = useState(false);

  if (position === 'admin') {
    // Admin: tiny dot in sidebar area, very subtle
    return (
      <>
        <button
          onClick={() => setOpen(true)}
          className="w-9 h-9 rounded-xl bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500 hover:bg-primary-100 hover:text-primary-500 transition-all flex items-center justify-center"
          title="Обратная связь"
        >
          <MessageSquarePlus size={16} />
        </button>
        <FeedbackModal open={open} onClose={() => setOpen(false)} />
      </>
    );
  }

  // Employee: small subtle button, not floating
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-gray-400 hover:text-primary-500 hover:bg-primary-50 transition-all"
        title="Обратная связь"
      >
        <MessageSquarePlus size={13} />
        <span>Обратная связь</span>
      </button>
      <FeedbackModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}
