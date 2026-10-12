import { useState, useEffect, useCallback, useRef } from 'react';
import { printBarcode } from '../../../utils/printBarcode';
import { ChevronLeft, ChevronRight, X, Printer } from 'lucide-react';
import { BoxIcon, ShelfIcon } from '../../../components/ui/WarehouseIcons';
import api from '../../../api/client';
import Spinner from '../../../components/ui/Spinner';

// ─── Visual Warehouse: Barcode SVG ───────────────────────────────────────────
export function BarcodeSVG({ value, height = 22 }) {
  let s = value.split('').reduce((a, c, i) => (a + c.charCodeAt(0) * (i + 1)) & 0xffff, 0);
  const bars = [];
  for (let i = 0; i < 36; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    bars.push({ w: s % 4 === 0 ? 2 : 1, dark: i === 0 || i === 35 || i % 2 === 0 || s % 3 > 0 });
  }
  let x = 1.5;
  const rects = [];
  bars.forEach(b => { if (b.dark) rects.push({ x, w: b.w }); x += b.w + 0.5; });
  const tw = x + 1;
  return (
    <svg width="100%" height={height} viewBox={`0 0 ${tw} ${height}`} preserveAspectRatio="none">
      {rects.map((r, i) => <rect key={i} x={r.x} y={0} width={r.w} height={height * 0.78} fill="#111" />)}
      <text x={tw / 2} y={height - 0.5} textAnchor="middle" fontSize={Math.max(3.5, height * 0.2)} fill="#222" fontFamily="monospace">{value}</text>
    </svg>
  );
}

// ─── Visual Warehouse: Demo product data ─────────────────────────────────────
export const DEMO_PRODUCTS = [
  { name: 'Витамин C 1000мг', sku: 'VIT-C1000', cat: 'Витамины', mfr: 'NaturePharma', weight: '320г', dims: '8×6×12см', lot: 'LOT-2025-04A' },
  { name: 'Омега-3 капсулы',  sku: 'OMG-3-90',  cat: 'Жирные кислоты', mfr: 'FishOil Co.', weight: '280г', dims: '7×5×11см', lot: 'LOT-2025-03B' },
  { name: 'Магний B6 табл.',  sku: 'MAG-B6-60', cat: 'Минералы',  mfr: 'MagniMax',    weight: '210г', dims: '6×5×10см', lot: 'LOT-2025-05A' },
  { name: 'Цинк 25мг',        sku: 'ZNC-25-100',cat: 'Минералы',  mfr: 'ZincPlus',    weight: '180г', dims: '6×4×9см',  lot: 'LOT-2025-02C' },
  { name: '5-HTP 100мг',      sku: 'HTP-5-60',  cat: 'Аминокислоты', mfr: 'NeuroBalance', weight: '200г', dims: '6×5×10см', lot: 'LOT-2025-04B' },
  { name: 'Коллаген морской',  sku: 'COL-MAR-30',cat: 'Коллаген', mfr: 'MarineLife',  weight: '350г', dims: '9×7×13см', lot: 'LOT-2025-01A' },
  { name: 'Мелатонин 3мг',    sku: 'MEL-3-30',  cat: 'Сон',      mfr: 'SleepWell',   weight: '90г',  dims: '4×4×8см',  lot: 'LOT-2025-06A' },
  { name: 'Железо 18мг',      sku: 'IRN-18-90', cat: 'Минералы', mfr: 'IronForce',   weight: '195г', dims: '6×5×10см', lot: 'LOT-2025-03A' },
  { name: 'Витамин D3 2000',  sku: 'VIT-D3-60', cat: 'Витамины', mfr: 'SunVit',      weight: '140г', dims: '5×4×9см',  lot: 'LOT-2025-05B' },
  { name: 'Куркумин 500мг',   sku: 'CUR-500-45',cat: 'Антиоксид.', mfr: 'GoldenRoot', weight: '220г', dims: '7×5×10см', lot: 'LOT-2025-04C' },
  { name: 'Пробиотик Pro-11', sku: 'PRB-11-30', cat: 'Пробиотики', mfr: 'BioFlora',  weight: '160г', dims: '5×4×9см',  lot: 'LOT-2025-02A' },
  { name: 'Глицин 400мг',     sku: 'GLY-400-50',cat: 'Аминокислоты', mfr: 'BrainFood', weight: '170г', dims: '6×4×9см',  lot: 'LOT-2025-06B' },
  { name: 'L-карнитин 500',   sku: 'LCN-500-60',cat: 'Спортпит', mfr: 'SportLab',    weight: '230г', dims: '7×5×11см', lot: 'LOT-2025-03C' },
  { name: 'Биотин 5000мкг',   sku: 'BIO-5000-30',cat: 'Витамины', mfr: 'HairBeauty', weight: '120г', dims: '5×4×8см',  lot: 'LOT-2025-01B' },
  { name: 'Фолиевая к-та',    sku: 'FOL-400-90',cat: 'Витамины', mfr: 'FolicPlus',   weight: '185г', dims: '6×4×10см', lot: 'LOT-2025-05C' },
  { name: 'Витамин B12',      sku: 'B12-500-30',cat: 'Витамины', mfr: 'CobaLab',     weight: '110г', dims: '4×4×8см',  lot: 'LOT-2025-02B' },
  { name: 'Рыбий жир 1000',   sku: 'FSH-1000-90',cat: 'Жирные кислоты', mfr: 'OceanPure', weight: '310г', dims: '8×6×12см', lot: 'LOT-2025-04D' },
  { name: 'Ашваганда 300мг',  sku: 'ASH-300-60',cat: 'Адаптогены', mfr: 'AyurWell', weight: '200г', dims: '6×5×10см', lot: 'LOT-2025-01C' },
];
export function getDemoProd(barcode) {
  const h = barcode.split('').reduce((a, c) => (a + c.charCodeAt(0)) & 0xffff, 0);
  return DEMO_PRODUCTS[h % DEMO_PRODUCTS.length];
}

// ─── Visual Warehouse: 3D Cardboard Box ──────────────────────────────────────
export function BoxFace({ prod, barcode }) {
  return (
    <>
      <div style={{ height: 8, margin: '0 4px', background: 'linear-gradient(135deg, #c8a03c 0%, #9e7625 100%)', borderRadius: '2px 2px 0 0' }} />
      <div style={{
        background: 'linear-gradient(180deg, #edbe62 0%, #d4a63e 55%, #c08e2c 100%)',
        border: '1px solid #b87e28', borderTop: 'none',
        borderRadius: '0 0 3px 3px',
        padding: '4px 3px 4px',
        minHeight: 82,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'space-between',
        position: 'relative', overflow: 'hidden', gap: 3,
      }}>
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: 'rgba(155,105,15,0.3)' }} />
        <p style={{
          fontSize: 9, fontWeight: 900, color: '#4a2e08',
          fontFamily: 'sans-serif', textAlign: 'center',
          lineHeight: 1.3, width: '100%',
          overflow: 'hidden', display: '-webkit-box',
          WebkitLineClamp: 3, WebkitBoxOrient: 'vertical',
          textTransform: 'uppercase', letterSpacing: '-0.2px',
          marginTop: 2, flexShrink: 0,
        }}>
          {prod.name}
        </p>
        <div style={{ width: '100%', height: 1, background: 'rgba(100,55,0,0.18)', flexShrink: 0 }} />
        <div style={{
          background: 'white', border: '1px solid #ccc', borderRadius: 1,
          padding: '0px 3px', display: 'flex', alignItems: 'center',
          height: 9, width: '25%', flexShrink: 0, overflow: 'hidden', alignSelf: 'flex-start',
        }}>
          <div style={{ width: '100%', height: 6, overflow: 'hidden', lineHeight: 0 }}>
            <BarcodeSVG value="DEMO" height={6} />
          </div>
        </div>
      </div>
      <div style={{
        position: 'absolute', top: 8, right: -3, bottom: 3, width: 4,
        background: 'linear-gradient(90deg, rgba(0,0,0,0.18), transparent)',
        borderRadius: '0 2px 2px 0', pointerEvents: 'none',
      }} />
    </>
  );
}

export function Box3D({ box, onPointerDown, onClick, isDragging, shiftX, isWiggling }) {
  const prod = getDemoProd(box.barcode_value);
  const springBase = 'transform 0.32s cubic-bezier(0.34, 1.56, 0.64, 1)';
  return (
    <div
      data-box-id={box.id}
      onPointerDown={e => { e.preventDefault(); onPointerDown(e); }}
      onClick={e => { if (Math.abs(shiftX || 0) < 2) onClick(e); }}
      title={`${prod.name} · ${box.barcode_value}`}
      style={{
        flex: 1, cursor: isDragging ? 'grabbing' : 'grab',
        userSelect: 'none', position: 'relative',
        opacity: isDragging ? 0.12 : 1,
        transform: `translateX(${shiftX || 0}px)`,
        transition: isDragging ? 'opacity 0.15s' : `${springBase}, opacity 0.15s`,
        animation: isWiggling && !isDragging ? 'wms-wiggle 0.45s ease-in-out infinite' : 'none',
        filter: 'drop-shadow(1px 3px 4px rgba(0,0,0,0.2))',
      }}
    >
      <BoxFace prod={prod} barcode={box.barcode_value} />
    </div>
  );
}

// ─── Visual Warehouse: Metal Rack ─────────────────────────────────────────────
export const VIS_POLE = 13;

export function RackVisual({ rack, onBoxClick, drag, startDrag }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
      <div style={{
        background: 'linear-gradient(180deg, #d4d8e0, #c0c4cc)',
        color: '#444', textAlign: 'center',
        padding: '3px 0', fontSize: 11, fontWeight: 800, letterSpacing: '0.12em',
        borderRadius: '4px 4px 0 0',
        border: '1px solid #b8bcc6', borderBottom: 'none',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.7)',
      }}>
        {rack.code}
      </div>

      <div style={{
        position: 'relative', flex: 1,
        background: '#f2f3f5',
        border: '1px solid #c0c4cc', borderTop: 'none',
        boxShadow: '2px 6px 18px rgba(0,0,0,0.13)',
      }}>
        <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: VIS_POLE, zIndex: 2, background: 'linear-gradient(90deg, #b8bcc6 0%, #dde0e6 45%, #eceef2 55%, #d4d8e0 100%)', borderRight: '1px solid #b0b4bc' }}>
          {Array.from({ length: 22 }, (_, i) => (<div key={i} style={{ position: 'absolute', left: 3, right: 3, top: 4 + i * 11, height: 4, background: '#a8acb6', borderRadius: 1, boxShadow: 'inset 0 1px 1px rgba(0,0,0,0.3)' }} />))}
        </div>
        <div style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: VIS_POLE, zIndex: 2, background: 'linear-gradient(90deg, #d4d8e0 0%, #eceef2 45%, #dde0e6 55%, #b8bcc6 100%)', borderLeft: '1px solid #b0b4bc' }}>
          {Array.from({ length: 22 }, (_, i) => (<div key={i} style={{ position: 'absolute', left: 3, right: 3, top: 4 + i * 11, height: 4, background: '#a8acb6', borderRadius: 1, boxShadow: 'inset 0 1px 1px rgba(0,0,0,0.3)' }} />))}
        </div>

        <div style={{ marginLeft: VIS_POLE, marginRight: VIS_POLE }}>
          {rack.shelves?.map((shelf) => {
            const isHovered = drag && drag.hoverShelfId === shelf.id;
            const hoverBoxIdx = isHovered && drag.hoverBoxId
              ? shelf.boxes?.findIndex(b => b.id === drag.hoverBoxId && b.id !== drag.boxId)
              : -1;
            const isWiggling = isHovered && hoverBoxIdx < 0;

            return (
              <div key={shelf.id}>
                <div style={{
                  height: 11,
                  background: 'linear-gradient(180deg, #e0e3ea 0%, #c8ccd4 40%, #a8acb8 100%)',
                  boxShadow: '0 3px 7px rgba(0,0,0,0.18), inset 0 1px 0 rgba(255,255,255,0.55)',
                  display: 'flex', alignItems: 'center', padding: '0 6px', gap: 5,
                }}>
                  <div style={{ background: 'white', border: '1px solid #bbb', borderRadius: 1, padding: '0px 3px', display: 'flex', alignItems: 'center', gap: 3, height: 8, flexShrink: 0 }}>
                    <span style={{ fontSize: 5.5, fontFamily: 'monospace', fontWeight: 800, color: '#333', lineHeight: 1, whiteSpace: 'nowrap' }}>{shelf.code}</span>
                    <div style={{ width: 24, height: 6, overflow: 'hidden', lineHeight: 0 }}>
                      <BarcodeSVG value={shelf.barcode_value || shelf.code} height={6} />
                    </div>
                  </div>
                </div>

                <div
                  data-shelf-id={shelf.id}
                  style={{
                    display: 'flex', gap: 6, alignItems: 'flex-end',
                    padding: '10px 6px 8px',
                    minHeight: 108,
                    background: isHovered ? 'rgba(99,102,241,0.05)' : 'transparent',
                    outline: isHovered ? '2px dashed rgba(99,102,241,0.35)' : '2px dashed transparent',
                    outlineOffset: -3,
                    transition: 'background 0.2s, outline 0.2s',
                  }}
                >
                  {shelf.boxes?.map((box, boxIdx) => {
                    const isDragging = drag?.boxId === box.id;
                    let shiftX = 0;
                    if (isHovered && !isDragging && hoverBoxIdx >= 0) {
                      shiftX = boxIdx >= hoverBoxIdx ? 20 : -20;
                    }
                    return (
                      <Box3D
                        key={box.id}
                        box={box}
                        isDragging={isDragging}
                        shiftX={shiftX}
                        isWiggling={isWiggling && !isDragging}
                        onPointerDown={e => startDrag(e, box, shelf, rack)}
                        onClick={() => !drag && onBoxClick({ box, shelf, rack })}
                      />
                    );
                  })}
                  {(!shelf.boxes || shelf.boxes.length === 0) && (
                    <div style={{ flex: 1, height: 76, border: '2px dashed #d0d3da', borderRadius: 3, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <span style={{ fontSize: 10, color: '#bbb' }}>пусто</span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          <div style={{ height: 10, background: 'linear-gradient(180deg, #d0d4dc 0%, #9094a4 100%)', boxShadow: '0 4px 10px rgba(0,0,0,0.22)' }} />
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', paddingLeft: VIS_POLE * 0.3, paddingRight: VIS_POLE * 0.3 }}>
        {[0, 1].map(i => (<div key={i} style={{ width: VIS_POLE, height: 14, background: 'linear-gradient(180deg, #b8bcc6, #80848e)', borderRadius: '0 0 3px 3px', boxShadow: '0 3px 6px rgba(0,0,0,0.18)' }} />))}
      </div>
    </div>
  );
}

// ─── Visual Warehouse View ────────────────────────────────────────────────────
export function VisualWarehouseView({ warehouse }) {
  const [racksData, setRacksData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [popup, setPopup] = useState(null);
  const [drag, setDrag] = useState(null);
  const dropRef = useRef(null);
  const lastXRef = useRef(0);
  const RACKS_PER_PAGE = 3;

  // Inject CSS keyframes
  useEffect(() => {
    const s = document.createElement('style');
    s.id = 'wms-box-anim';
    s.textContent = `
      @keyframes wms-wiggle {
        0%,100% { transform: rotate(0deg) scale(1); }
        20% { transform: rotate(-3deg) scale(1.05); }
        60% { transform: rotate(3deg) scale(1.05); }
      }
    `;
    document.head.appendChild(s);
    return () => document.getElementById('wms-box-anim')?.remove();
  }, []);

  useEffect(() => {
    setLoading(true);
    api.get(`/warehouse/visual/${warehouse.id}`)
      .then(r => setRacksData(r.data.racks || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [warehouse.id]);

  const handleMove = useCallback((boxId, fromShelfId, toShelfId) => {
    setRacksData(prev => {
      let movedBox = null;
      for (const rack of prev) {
        for (const shelf of (rack.shelves || [])) {
          const f = (shelf.boxes || []).find(b => b.id === boxId);
          if (f) { movedBox = f; break; }
        }
        if (movedBox) break;
      }
      if (!movedBox) return prev;
      return prev.map(rack => ({
        ...rack,
        shelves: rack.shelves?.map(shelf => {
          if (shelf.id === fromShelfId) return { ...shelf, boxes: shelf.boxes.filter(b => b.id !== boxId) };
          if (shelf.id === toShelfId) return { ...shelf, boxes: [...(shelf.boxes || []), movedBox] };
          return shelf;
        }),
      }));
    });
  }, []);

  const startDrag = useCallback((e, box, shelf, rack) => {
    e.preventDefault();
    lastXRef.current = e.clientX;
    setDrag({
      boxId: box.id, fromShelfId: shelf.id,
      ghostX: e.clientX, ghostY: e.clientY, rotation: 0,
      prod: getDemoProd(box.barcode_value),
      hoverShelfId: null, hoverBoxId: null,
    });
  }, []);

  useEffect(() => {
    if (!drag) return;
    const fromShelfId = drag.fromShelfId;
    const boxId = drag.boxId;

    const onMove = (e) => {
      const vx = e.clientX - lastXRef.current;
      lastXRef.current = e.clientX;
      const rotation = Math.max(-14, Math.min(14, vx * 1.2));

      const el = document.elementFromPoint(e.clientX, e.clientY);
      const shelfEl = el?.closest('[data-shelf-id]');
      const boxEl = el?.closest('[data-box-id]');
      const hoverShelfId = shelfEl ? +shelfEl.dataset.shelfId : null;
      const hoverBoxId = boxEl ? +boxEl.dataset.boxId : null;

      dropRef.current = { hoverShelfId, hoverBoxId };
      setDrag(d => d ? { ...d, ghostX: e.clientX, ghostY: e.clientY, rotation, hoverShelfId, hoverBoxId } : null);
    };

    const onUp = () => {
      const t = dropRef.current;
      if (t?.hoverShelfId && t.hoverShelfId !== fromShelfId) {
        handleMove(boxId, fromShelfId, t.hoverShelfId);
      }
      setDrag(null);
      dropRef.current = null;
      document.body.style.cursor = '';
    };

    document.body.style.cursor = 'grabbing';
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      document.body.style.cursor = '';
    };
  }, [drag?.boxId]);

  if (loading) return <div className="flex items-center justify-center h-48"><Spinner size="lg" /></div>;

  const totalPages = Math.ceil(racksData.length / RACKS_PER_PAGE);
  const visibleRacks = racksData.slice(page * RACKS_PER_PAGE, (page + 1) * RACKS_PER_PAGE);

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
          className="p-2.5 rounded-xl border border-gray-200 text-gray-500 hover:border-gray-400 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed transition-all">
          <ChevronLeft size={20} />
        </button>
        <span className="text-sm text-gray-500 font-medium">
          {page * RACKS_PER_PAGE + 1}–{Math.min((page + 1) * RACKS_PER_PAGE, racksData.length)} из {racksData.length} стеллажей
        </span>
        <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}
          className="p-2.5 rounded-xl border border-gray-200 text-gray-500 hover:border-gray-400 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed transition-all">
          <ChevronRight size={20} />
        </button>
      </div>

      <p className="text-xs text-gray-400 mb-4 text-center">Перетащите коробку на другую полку чтобы переместить</p>

      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        {visibleRacks.map(rack => (
          <RackVisual key={rack.id} rack={rack} onBoxClick={setPopup} drag={drag} startDrag={startDrag} />
        ))}
      </div>

      {/* Drag ghost */}
      {drag && (
        <div style={{
          position: 'fixed',
          left: drag.ghostX - 36,
          top: drag.ghostY - 62,
          width: 72,
          zIndex: 9999,
          pointerEvents: 'none',
          transform: `rotate(${drag.rotation}deg) scale(1.1)`,
          transition: 'transform 0.15s cubic-bezier(0.34, 1.56, 0.64, 1)',
          filter: 'drop-shadow(6px 16px 28px rgba(0,0,0,0.65))',
        }}>
          <BoxFace prod={drag.prod} barcode="DEMO" />
        </div>
      )}

      {/* Box popup */}
      {popup && (() => {
        const prod = getDemoProd(popup.box.barcode_value);
        const Field = ({ label, value, mono }) => (
          <div>
            <p className="text-[10px] text-gray-400 font-medium mb-0.5 uppercase tracking-wide">{label}</p>
            <p className={`text-sm text-gray-800 font-medium ${mono ? 'font-mono' : ''} ${!value ? 'text-gray-300' : ''}`}>
              {value || '—'}
            </p>
          </div>
        );
        const Section = ({ title, children }) => (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{title}</span>
              <div className="flex-1 h-px bg-gray-100" />
            </div>
            {children}
          </div>
        );
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setPopup(null)}>
            <div className="absolute inset-0 bg-black/50" />
            <div className="relative bg-white rounded-2xl shadow-2xl z-10 w-full overflow-y-auto"
              style={{ maxWidth: 560, maxHeight: '90vh' }} onClick={e => e.stopPropagation()}>
              <div className="flex items-start justify-between p-5 pb-4 border-b border-gray-100">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-amber-50 border border-amber-200 flex items-center justify-center flex-shrink-0">
                    <BoxIcon size={22} />
                  </div>
                  <div>
                    <p className="font-bold text-gray-900 dark:text-white text-base">{prod.name}</p>
                    <p className="text-xs text-gray-500 mt-0.5 font-mono">{popup.box.barcode_value}</p>
                  </div>
                </div>
                <button onClick={() => setPopup(null)} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 ml-3 flex-shrink-0">
                  <X size={16} />
                </button>
              </div>

              <div className="p-5 space-y-5">
                <div className="bg-gray-50 border border-gray-100 rounded-xl p-4">
                  <BarcodeSVG value={popup.box.barcode_value} height={52} />
                  <div className="flex justify-end mt-2">
                    <button onClick={() => printBarcode(popup.box.barcode_value, popup.shelf.code, prod.name)}
                      className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-primary-600 hover:bg-primary-50 px-2.5 py-1.5 rounded-lg transition-all">
                      <Printer size={12} /> Печать
                    </button>
                  </div>
                </div>

                <Section title="Местонахождение">
                  <div className="flex gap-2 flex-wrap">
                    {[{ label: 'Склад', val: 'Экспериментальный' }, { label: 'Стеллаж', val: popup.rack.code }, { label: 'Полка', val: popup.shelf.code }, { label: 'Коробка', val: popup.box.name }].map(item => (
                      <div key={item.label} className="flex flex-col items-center bg-primary-50 border border-primary-100 rounded-xl px-4 py-2 min-w-[90px]">
                        <span className="text-[9px] text-primary-400 font-semibold uppercase tracking-wider">{item.label}</span>
                        <span className="text-sm font-bold text-primary-700 mt-0.5 font-mono">{item.val}</span>
                      </div>
                    ))}
                  </div>
                </Section>

                <Section title="Товар">
                  <div className="grid grid-cols-2 gap-x-6 gap-y-4">
                    <Field label="Название" value={prod.name} />
                    <Field label="Артикул" value={prod.sku} mono />
                    <Field label="Категория" value={prod.cat} />
                    <Field label="Производитель" value={prod.mfr} />
                    <Field label="Количество, шт." value={null} />
                    <Field label="Ед. измерения" value="шт." />
                  </div>
                </Section>

                <Section title="Упаковка">
                  <div className="grid grid-cols-2 gap-x-6 gap-y-4">
                    <Field label="Дата упаковки" value={null} />
                    <Field label="Серийный номер" value={null} mono />
                    <Field label="Партия / Лот" value={prod.lot} mono />
                    <Field label="Срок годности" value={null} />
                  </div>
                </Section>

                <Section title="Физические параметры">
                  <div className="grid grid-cols-3 gap-x-4 gap-y-4">
                    <Field label="Вес нетто" value={prod.weight} />
                    <Field label="Вес брутто" value={null} />
                    <Field label="Объём, м³" value={null} />
                    <Field label="Д × Ш × В" value={prod.dims} />
                    <Field label="Тара" value={null} />
                    <Field label="Кол-во в уп." value={null} />
                  </div>
                </Section>

                <Section title="Логистика">
                  <div className="grid grid-cols-2 gap-x-6 gap-y-4">
                    <Field label="Поставщик" value={null} />
                    <Field label="Транспортная компания" value={null} />
                    <Field label="Дата прихода" value={null} />
                    <Field label="Номер накладной" value={null} mono />
                    <Field label="Ответственный" value={null} />
                    <Field label="Статус" value="На хранении" />
                  </div>
                </Section>

                <Section title="Примечание">
                  <div className="bg-gray-50 rounded-xl p-3 min-h-[52px] border border-gray-100">
                    <p className="text-sm text-gray-300">Нет примечаний</p>
                  </div>
                </Section>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
