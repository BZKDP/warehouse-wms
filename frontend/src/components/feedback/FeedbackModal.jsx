import { useState, useRef, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Bug, Lightbulb, HelpCircle, Camera, Mic, X, Send, ScanLine, Monitor, Database, Warehouse, MoreHorizontal, Sparkles, Wrench, Hand, Square, Trash2, Upload } from 'lucide-react';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import { useToast } from '../ui/Toast';
import { useAuth } from '../../context/AuthContext';
import api from '../../api/client';

const CATEGORIES = [
  { key: 'bug', label: 'Баг', icon: Bug, color: 'bg-rose-50 text-rose-600 border-rose-200', activeColor: 'bg-rose-600 text-white border-rose-600' },
  { key: 'suggestion', label: 'Предложение', icon: Lightbulb, color: 'bg-amber-50 text-amber-600 border-amber-200', activeColor: 'bg-amber-500 text-white border-amber-500' },
  { key: 'question', label: 'Вопрос', icon: HelpCircle, color: 'bg-blue-50 text-blue-600 border-blue-200', activeColor: 'bg-blue-600 text-white border-blue-600' },
];

const SUB_CATEGORIES = {
  bug: [
    { key: 'scanning', label: 'Сканирование', icon: ScanLine },
    { key: 'ui', label: 'Интерфейс', icon: Monitor },
    { key: 'data', label: 'Данные', icon: Database },
    { key: 'warehouse', label: 'Склад', icon: Warehouse },
    { key: 'other', label: 'Другое', icon: MoreHorizontal },
  ],
  suggestion: [
    { key: 'ui', label: 'Интерфейс', icon: Monitor },
    { key: 'feature', label: 'Новая функция', icon: Sparkles },
    { key: 'usability', label: 'Удобство', icon: Hand },
    { key: 'other', label: 'Другое', icon: MoreHorizontal },
  ],
  question: [
    { key: 'howto', label: 'Как сделать?', icon: HelpCircle },
    { key: 'broken', label: 'Не работает', icon: Wrench },
    { key: 'other', label: 'Другое', icon: MoreHorizontal },
  ],
};

export default function FeedbackModal({ open, onClose }) {
  const toast = useToast();
  const { user } = useAuth();
  const [category, setCategory] = useState(null);
  const [subcategory, setSubcategory] = useState(null);
  const [description, setDescription] = useState('');
  const [screenshot, setScreenshot] = useState(null);
  const [screenshotPreview, setScreenshotPreview] = useState(null);
  const [sending, setSending] = useState(false);

  // Voice recording state
  const [isRecording, setIsRecording] = useState(false);
  const [audioBlob, setAudioBlob] = useState(null);
  const [audioUrl, setAudioUrl] = useState(null);
  const [recordDuration, setRecordDuration] = useState(0);
  const [transcript, setTranscript] = useState('');
  const [liveTranscript, setLiveTranscript] = useState('');
  const mediaRecorderRef = useRef(null);
  const recognitionRef = useRef(null);
  const timerRef = useRef(null);
  const fileRef = useRef(null);
  const audioFileRef = useRef(null);

  const hasSpeechAPI = typeof window !== 'undefined' && ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window);
  const isSecureContext = typeof window !== 'undefined' && (window.isSecureContext || window.location.protocol === 'https:' || window.location.hostname === 'localhost');

  // Reset form when modal opens
  useEffect(() => {
    if (open) {
      setCategory(null); setSubcategory(null); setDescription('');
      setScreenshot(null); setScreenshotPreview(null);
      setAudioBlob(null); setAudioUrl(null); setRecordDuration(0);
      setTranscript(''); setLiveTranscript('');
    }
  }, [open]);

  // Ctrl+V paste screenshot (works from anywhere in modal)
  useEffect(() => {
    if (!open) return;
    const handlePaste = (e) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          e.preventDefault();
          const file = item.getAsFile();
          if (file) {
            if (file.size > 5 * 1024 * 1024) { toast.error('Макс. размер 5 МБ'); return; }
            setScreenshot(file);
            setScreenshotPreview(URL.createObjectURL(file));
            toast.success('Скриншот вставлен (Ctrl+V)');
          }
          break;
        }
      }
    };
    window.addEventListener('paste', handlePaste, true);
    return () => window.removeEventListener('paste', handlePaste, true);
  }, [open, toast]);

  // Screenshot
  const handleScreenshot = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { toast.error('Макс. размер 5 МБ'); return; }
    setScreenshot(file);
    setScreenshotPreview(URL.createObjectURL(file));
  };

  const removeScreenshot = () => {
    setScreenshot(null);
    if (screenshotPreview) URL.revokeObjectURL(screenshotPreview);
    setScreenshotPreview(null);
    if (fileRef.current) fileRef.current.value = '';
  };

  // Voice recording
  const startRecording = useCallback(async () => {
    if (!isSecureContext) {
      toast.error('Микрофон доступен только по HTTPS. Используйте текстовое описание.');
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      toast.error('Браузер не поддерживает запись с микрофона');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, { mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm' });
      const chunks = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: recorder.mimeType });
        setAudioBlob(blob);
        setAudioUrl(URL.createObjectURL(blob));
        stream.getTracks().forEach(t => t.stop());
      };
      recorder.start(1000);
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
      setRecordDuration(0);
      timerRef.current = setInterval(() => setRecordDuration(d => d + 1), 1000);

      // Speech recognition
      if (hasSpeechAPI) {
        const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        const recognition = new SR();
        recognition.lang = 'ru-RU';
        recognition.continuous = true;
        recognition.interimResults = true;
        let finalText = '';
        recognition.onresult = (e) => {
          let interim = '';
          for (let i = e.resultIndex; i < e.results.length; i++) {
            if (e.results[i].isFinal) finalText += e.results[i][0].transcript + ' ';
            else interim = e.results[i][0].transcript;
          }
          setTranscript(finalText.trim());
          setLiveTranscript(interim);
        };
        recognition.onend = () => { if (mediaRecorderRef.current?.state === 'recording') recognition.start(); };
        recognition.start();
        recognitionRef.current = recognition;
      }
    } catch (err) {
      toast.error('Не удалось получить доступ к микрофону');
    }
  }, [hasSpeechAPI, toast]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current?.state === 'recording') mediaRecorderRef.current.stop();
    if (recognitionRef.current) { try { recognitionRef.current.stop(); } catch {} }
    if (timerRef.current) clearInterval(timerRef.current);
    setIsRecording(false);
    setLiveTranscript('');
  }, []);

  const removeAudio = () => {
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioBlob(null); setAudioUrl(null); setRecordDuration(0); setTranscript('');
  };

  const fmtTime = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

  // Submit
  const handleSubmit = async () => {
    if (!category) { toast.error('Выберите категорию'); return; }
    if (!description.trim() && !transcript.trim() && !audioBlob) {
      toast.error('Опишите проблему или запишите голос');
      return;
    }

    setSending(true);
    try {
      const fd = new FormData();
      fd.append('category', category);
      if (subcategory) fd.append('subcategory', subcategory);
      fd.append('description', description || transcript || '');
      if (transcript) fd.append('transcript', transcript);
      fd.append('page_url', window.location.href);
      fd.append('browser_info', navigator.userAgent);
      if (screenshot) fd.append('screenshot', screenshot);
      if (audioBlob) fd.append('audio', audioBlob, 'voice.webm');

      await api.post('/feedback', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      toast.success('Спасибо! Ваш отзыв отправлен');
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Не удалось отправить');
    } finally { setSending(false); }
  };

  const subs = category ? (SUB_CATEGORIES[category] || []) : [];

  return createPortal(
    <Modal open={open} onClose={onClose} title="Обратная связь" size="lg" footer={
      <div className="flex items-center justify-between w-full">
        <p className="text-xs text-gray-400">{user?.username || 'Аноним'} · {new Date().toLocaleDateString('ru-RU')}</p>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose}>Отмена</Button>
          <Button icon={<Send size={14} />} loading={sending} onClick={handleSubmit}>Отправить</Button>
        </div>
      </div>
    }>
      <div className="space-y-5">
        {/* Category */}
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Что случилось?</p>
          <div className="flex gap-2">
            {CATEGORIES.map(c => {
              const Icon = c.icon;
              const active = category === c.key;
              return (
                <button key={c.key} onClick={() => { setCategory(c.key); setSubcategory(null); }}
                  className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border text-sm font-semibold transition-all ${active ? c.activeColor : c.color + ' hover:opacity-80'}`}>
                  <Icon size={16} />
                  {c.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Subcategory */}
        {subs.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Уточните</p>
            <div className="flex flex-wrap gap-2">
              {subs.map(s => {
                const Icon = s.icon;
                const active = subcategory === s.key;
                return (
                  <button key={s.key} onClick={() => setSubcategory(active ? null : s.key)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all ${active ? 'bg-primary-600 text-white border-primary-600' : 'bg-gray-50 text-gray-600 border-gray-200 hover:border-gray-300'}`}>
                    <Icon size={13} />
                    {s.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Description */}
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Описание</p>
          <textarea
            rows={4}
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="Опишите проблему, предложение или вопрос..."
            className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm text-gray-900 placeholder:text-gray-300 focus:border-primary-400 focus:ring-2 focus:ring-primary-100 focus:outline-none resize-none"
          />
          {/* Live transcript */}
          {(transcript || liveTranscript) && (
            <div className="mt-2 px-3 py-2 bg-blue-50 border border-blue-100 rounded-lg">
              <p className="text-xs font-semibold text-blue-500 mb-1">Распознанный текст:</p>
              <p className="text-sm text-blue-800">{transcript}{liveTranscript && <span className="text-blue-400 italic"> {liveTranscript}</span>}</p>
            </div>
          )}
        </div>

        {/* Actions: Screenshot + Voice */}
        <div className="flex gap-3">
          {/* Screenshot */}
          <div className="flex-1">
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleScreenshot} />
            {!screenshot ? (
              <button onClick={() => fileRef.current?.click()}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl border-2 border-dashed border-gray-200 text-sm font-medium text-gray-500 hover:border-primary-300 hover:text-primary-600 transition-colors">
                <Camera size={16} />
                Скриншот
              </button>
            ) : (
              <div className="relative rounded-xl overflow-hidden border border-gray-200">
                <img src={screenshotPreview} alt="Скриншот" className="w-full h-24 object-cover" />
                <button onClick={removeScreenshot}
                  className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-rose-500 text-white flex items-center justify-center hover:bg-rose-600">
                  <X size={12} />
                </button>
              </div>
            )}
          </div>

          {/* Voice: record if HTTPS, upload file if HTTP */}
          <div className="flex-1">
            {!audioBlob && !isRecording && (
              isSecureContext ? (
                <button onClick={startRecording}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl border-2 border-dashed border-gray-200 text-sm font-medium text-gray-500 hover:border-primary-300 hover:text-primary-600 transition-colors">
                  <Mic size={16} />
                  Записать голос
                </button>
              ) : (
                <>
                  <input ref={audioFileRef} type="file" accept="audio/*" className="hidden" onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    if (file.size > 10 * 1024 * 1024) { toast.error('Макс. 10 МБ'); return; }
                    setAudioBlob(file);
                    setAudioUrl(URL.createObjectURL(file));
                  }} />
                  <button onClick={() => audioFileRef.current?.click()}
                    className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl border-2 border-dashed border-gray-200 text-sm font-medium text-gray-500 hover:border-primary-300 hover:text-primary-600 transition-colors">
                    <Upload size={16} />
                    Голосовое
                  </button>
                </>
              )
            )}
            {isRecording && (
              <div className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-rose-50 border border-rose-200">
                <div className="w-3 h-3 rounded-full bg-rose-500 animate-pulse flex-shrink-0" />
                <span className="text-sm font-bold text-rose-600 flex-1">{fmtTime(recordDuration)}</span>
                <button onClick={stopRecording} className="w-8 h-8 rounded-full bg-rose-500 text-white flex items-center justify-center hover:bg-rose-600">
                  <Square size={12} fill="white" />
                </button>
              </div>
            )}
            {audioBlob && !isRecording && (
              <div className="w-full flex items-center gap-2 px-3 py-2 rounded-xl bg-green-50 border border-green-200">
                <audio src={audioUrl} controls className="flex-1 h-8" style={{ minWidth: 0 }} />
                <button onClick={removeAudio} className="w-6 h-6 rounded-full bg-rose-100 text-rose-500 flex items-center justify-center hover:bg-rose-200 flex-shrink-0">
                  <Trash2 size={11} />
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </Modal>,
    document.body
  );
}
