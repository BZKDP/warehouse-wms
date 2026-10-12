import { useState, useCallback, useRef, useEffect } from 'react';

// ─── Config ────────────────────────────────────────────────────────────────────
const ROWS     = 3;
const COLS     = 5;
const MAX_BOXES = 12;   // 4 wide × 3 tall
const BOX_COLS = 4;
const BOX_ROWS = 3;
const FONT = '"Helvetica Neue", Arial, sans-serif';

const CAT = {
  vitamin: { color: '#c07830', label: 'Витамины' },
  mineral: { color: '#1e7ea0', label: 'Минералы / Омега' },
  amino:   { color: '#6a48b0', label: 'Аминокислоты' },
  other:   { color: '#3f8050', label: 'Адаптогены' },
};

const PRODUCTS = [
  { name: 'Витамин C 1000мг',  cat: 'vitamin' },
  { name: 'Витамин D3 2000',   cat: 'vitamin' },
  { name: 'Биотин 5000мкг',    cat: 'vitamin' },
  { name: 'Фолиевая кислота',  cat: 'vitamin' },
  { name: 'Витамин B12',       cat: 'vitamin' },
  { name: 'Омега-3 капсулы',   cat: 'mineral' },
  { name: 'Магний B6 табл.',   cat: 'mineral' },
  { name: 'Цинк 25мг',         cat: 'mineral' },
  { name: 'Железо 18мг',       cat: 'mineral' },
  { name: 'Коллаген морской',  cat: 'mineral' },
  { name: 'Рыбий жир 1000',    cat: 'mineral' },
  { name: '5-HTP 100мг',       cat: 'amino'   },
  { name: 'Глицин 400мг',      cat: 'amino'   },
  { name: 'L-карнитин 500',    cat: 'amino'   },
  { name: 'Мелатонин 3мг',     cat: 'other'   },
  { name: 'Куркумин 500мг',    cat: 'other'   },
  { name: 'Пробиотик Pro-11',  cat: 'other'   },
  { name: 'Ашваганда 300мг',   cat: 'other'   },
];

function lcg(s) { return (((s ^ 0xdeadbeef) * 1664525 + 1013904223) & 0x7fffffff) / 0x7fffffff; }

function generateData() {
  return Array.from({ length: ROWS * COLS }, (_, i) => {
    const row  = Math.floor(i / COLS) + 1;
    const col  = (i % COLS) + 1;
    const seed = i * 98765 + 12345;
    const cnt  = Math.round(lcg(seed) * MAX_BOXES);
    return {
      id: i + 1,
      code: `Р${row}-${col.toString().padStart(2, '0')}`,
      barcode_value: `PLT-${(i + 1).toString().padStart(3, '0')}`,
      row, col,
      boxes: Array.from({ length: cnt }, (_, bi) => {
        const bs   = seed * 31 + bi * 7919;
        const prod = PRODUCTS[Math.floor(lcg(bs) * PRODUCTS.length)];
        return {
          id:  (i + 1) * 100 + bi + 1,
          barcode_value: `BX-${(i + 1).toString().padStart(3, '0')}-${(bi + 1).toString().padStart(2, '0')}`,
          product: { ...prod, color: CAT[prod.cat].color },
          qty: Math.floor(lcg(bs * 3) * 48) + 2,
        };
      }),
    };
  });
}

// ─── Color helpers ─────────────────────────────────────────────────────────────
function ph(hex)    { return [parseInt(hex.slice(1,3),16), parseInt(hex.slice(3,5),16), parseInt(hex.slice(5,7),16)]; }
function lighten(hex, a) { const [r,g,b]=ph(hex); return `rgb(${Math.round(r+(255-r)*a)},${Math.round(g+(255-g)*a)},${Math.round(b+(255-b)*a)})`; }
function darken(hex,  a) { const [r,g,b]=ph(hex); return `rgb(${Math.round(r*(1-a))},${Math.round(g*(1-a))},${Math.round(b*(1-a))})`; }
function rgba(hex,    a) { const [r,g,b]=ph(hex); return `rgba(${r},${g},${b},${a})`; }

// ─── Cardboard box — detail view (front-facing, large) ─────────────────────────
function BoxCard({ box, active, onClick }) {
  const [hov, setHov] = useState(false);
  const c = box.product?.color || '#c07830';
  const W = 74, H = 90;

  return (
    <div onClick={onClick} onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{ width: W, flexShrink: 0, cursor: 'pointer', position: 'relative',
        transform: hov || active ? 'translateY(-7px) scale(1.04)' : 'none',
        transition: 'transform .15s',
        filter: active ? `drop-shadow(0 0 9px ${rgba(c,.65)})` : `drop-shadow(1px 5px 7px rgba(0,0,0,.18))`,
      }}>
      {/* ── Top cap (folded lid) ── */}
      <div style={{ height: 10, position: 'relative', overflow: 'hidden',
        background: `linear-gradient(135deg, ${lighten(c,.55)}, ${lighten(c,.25)})`,
        border: `1px solid ${darken(c,.08)}`, borderBottom: 'none',
        borderRadius: '4px 4px 0 0' }}>
        {/* lid crease lines */}
        <div style={{ position:'absolute', top:0, bottom:0, left:'48%', right:'48%', background:'rgba(0,0,0,.1)' }} />
        <div style={{ position:'absolute', top:3, left:8, right:8, height:1, background:'rgba(255,255,255,.4)' }} />
      </div>
      {/* ── Front face ── */}
      <div style={{ height: H - 10, borderRadius: '0 0 4px 4px', overflow: 'hidden', position: 'relative',
        background: `linear-gradient(168deg, ${lighten(c,.3)} 0%, ${c} 55%, ${darken(c,.22)} 100%)`,
        border: `1px solid ${darken(c,.2)}`, borderTop: 'none',
        padding: '5px 5px 4px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', alignItems: 'center' }}>
        {/* tape cross */}
        <div style={{ position:'absolute', top:0, left:'30%', right:'30%', height:2, background:'rgba(255,255,255,.28)', zIndex:0 }} />
        <div style={{ position:'absolute', top:0, bottom:0, left:'46%', right:'46%', background:'rgba(255,255,255,.13)', zIndex:0 }} />
        {/* product name */}
        <p style={{ fontSize:8, fontWeight:700, fontFamily:FONT, color:'#fff', textAlign:'center', lineHeight:1.3,
          margin:'3px 0 0', textTransform:'uppercase', letterSpacing:'-.15px', textShadow:'0 1px 3px rgba(0,0,0,.32)',
          overflow:'hidden', display:'-webkit-box', WebkitLineClamp:3, WebkitBoxOrient:'vertical',
          width:'100%', position:'relative', zIndex:1 }}>
          {box.product?.name || '?'}
        </p>
        <div style={{ width:'80%', height:1, background:'rgba(255,255,255,.2)', flexShrink:0, zIndex:1 }} />
        <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:2, zIndex:1 }}>
          <span style={{ fontSize:11, fontWeight:800, fontFamily:FONT, color:'rgba(255,255,255,.95)', textShadow:'0 1px 2px rgba(0,0,0,.28)' }}>
            {box.qty}&nbsp;шт.
          </span>
          <span style={{ fontSize:6.5, fontFamily:'monospace', color:'rgba(255,255,255,.5)' }}>
            {box.barcode_value.slice(-8)}
          </span>
        </div>
      </div>
      {/* ── Right side edge ── */}
      <div style={{ position:'absolute', right:-5, top:5, bottom:0, width:5,
        background:`linear-gradient(90deg, ${darken(c,.28)}, ${darken(c,.38)})`,
        borderRadius:'0 3px 3px 0', pointerEvents:'none' }} />
      {/* ── Active outline ── */}
      {active && <div style={{ position:'absolute', inset:-3, borderRadius:6, border:`2px solid ${c}`, pointerEvents:'none' }} />}
    </div>
  );
}

// ─── Wooden pallet base (front view) ──────────────────────────────────────────
function PalletBase({ width }) {
  return (
    <div style={{ width, flexShrink:0 }}>
      {/* Top deck: horizontal planks */}
      <div style={{ height:12, position:'relative', overflow:'hidden',
        background:'repeating-linear-gradient(90deg, #c89838 0px, #bd8e35 26px, #7a5020 26px, #7a5020 28px, #c89838 28px)',
        border:'2px solid #7a5020', boxShadow:'inset 0 2px 0 rgba(255,255,255,.28), inset 0 -1px 0 rgba(0,0,0,.12)' }}>
        <div style={{ position:'absolute', inset:0, background:'linear-gradient(180deg, rgba(255,255,255,.12), transparent 60%)' }} />
      </div>
      {/* Middle: 3 stringers + 2 forklift slots */}
      <div style={{ height:24, display:'flex', border:'2px solid #7a5020', borderTop:'none', borderBottom:'none' }}>
        <div style={{ flex:1.4, background:'linear-gradient(180deg,#a07830,#7a5020)', boxShadow:'inset 1px 0 0 rgba(255,255,255,.12)' }} />
        <div style={{ flex:2.4, background:'#eae4da', borderLeft:'2px solid #c8a058', borderRight:'2px solid #c8a058',
          boxShadow:'inset 0 3px 6px rgba(0,0,0,.12)' }} />
        <div style={{ flex:1, background:'linear-gradient(180deg,#a07830,#7a5020)' }} />
        <div style={{ flex:2.4, background:'#eae4da', borderLeft:'2px solid #c8a058', borderRight:'2px solid #c8a058',
          boxShadow:'inset 0 3px 6px rgba(0,0,0,.12)' }} />
        <div style={{ flex:1.4, background:'linear-gradient(180deg,#a07830,#7a5020)', boxShadow:'inset -1px 0 0 rgba(255,255,255,.12)' }} />
      </div>
      {/* Bottom deck */}
      <div style={{ height:10, position:'relative', overflow:'hidden',
        background:'repeating-linear-gradient(90deg, #9a7020 0px, #907028 26px, #6a4818 26px, #6a4818 28px, #9a7020 28px)',
        border:'2px solid #6a4818', borderTop:'none',
        boxShadow:'0 6px 16px rgba(0,0,0,.22), inset 0 -2px 0 rgba(0,0,0,.12)' }}>
        <div style={{ position:'absolute', inset:0, background:'linear-gradient(180deg, rgba(0,0,0,.08), transparent 40%)' }} />
      </div>
    </div>
  );
}

// ─── Pallet detail view (front / shelf view) ──────────────────────────────────
function PalletDetailView({ pallet, activeBoxId, onBoxClick }) {
  const W = 74 * BOX_COLS + 6 * (BOX_COLS - 1);
  return (
    <div>
      {/* Boxes: rows from top (row 0) to bottom (row BOX_ROWS-1) */}
      <div style={{ display:'flex', flexDirection:'column-reverse', gap:5 }}>
        {Array.from({ length: BOX_ROWS }, (_, ri) => {
          const rowBoxes = pallet.boxes.slice(ri * BOX_COLS, (ri + 1) * BOX_COLS);
          return (
            <div key={ri} style={{ display:'flex', gap:6, alignItems:'flex-end' }}>
              {Array.from({ length: BOX_COLS }, (_, ci) => {
                const box = rowBoxes[ci];
                if (!box) return (
                  <div key={`e${ci}`} style={{ width:74, height:90, border:'2px dashed #e0dbd4',
                    borderRadius:4, background:'rgba(0,0,0,.02)', flexShrink:0 }} />
                );
                return <BoxCard key={box.id} box={box} active={activeBoxId === box.id} onClick={() => onBoxClick(box)} />;
              })}
            </div>
          );
        })}
      </div>
      {/* Wooden pallet base */}
      <div style={{ marginTop:4 }}>
        <PalletBase width={W} />
      </div>
    </div>
  );
}

// ─── Mini box for floor pallet cell ───────────────────────────────────────────
function MiniBox({ box, isDragging, onPointerDown }) {
  const [hov, setHov] = useState(false);
  const c = box.product?.color || '#c07830';
  return (
    <div data-box-id={box.id}
      onPointerDown={e => { e.stopPropagation(); onPointerDown(e); }}
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{ borderRadius:2, cursor:'grab', position:'relative', overflow:'hidden',
        opacity: isDragging ? 0.18 : 1,
        transform: hov && !isDragging ? 'scale(1.12)' : 'scale(1)',
        transition: 'transform .07s, opacity .1s',
        background: `linear-gradient(135deg, ${lighten(c,.25)}, ${c})`,
        border: `1px solid ${darken(c,.18)}`,
        boxShadow: `inset 0 1px 0 rgba(255,255,255,.32), inset 0 -1px 0 rgba(0,0,0,.14)`,
      }}>
      {/* top edge highlight */}
      <div style={{ position:'absolute', top:0, left:0, right:0, height:'30%',
        background:'rgba(255,255,255,.18)', pointerEvents:'none' }} />
    </div>
  );
}

// ─── Floor pallet cell (perspective top view) ─────────────────────────────────
function FloorPallet({ pallet, selected, isDragOver, canDrop, dragBoxId, onBoxPointerDown, onPalletPointerDown, onClick }) {
  const [hov, setHov] = useState(false);
  const fill = pallet.boxes.length;
  const pct  = fill / MAX_BOXES;
  const bc   = selected ? '#4f46e5' : isDragOver && canDrop ? '#16a34a' : isDragOver ? '#ef4444' : null;

  return (
    <div data-pallet-id={pallet.id} onClick={onClick}
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{ display:'inline-flex', flexDirection:'column', alignItems:'center', cursor:'pointer',
        outline: bc ? `3px solid ${bc}` : 'none', outlineOffset:4, borderRadius:6,
        transform: hov && !selected ? 'translateY(-4px)' : 'none',
        transition: 'transform .14s, outline .08s',
        filter: selected ? 'drop-shadow(0 8px 18px rgba(79,70,229,.28))' : hov ? 'drop-shadow(0 5px 14px rgba(0,0,0,.2))' : 'drop-shadow(0 2px 7px rgba(0,0,0,.12))',
      }}>

      {/* Code label (drag handle) */}
      <div data-pallet-header-id={pallet.id}
        onPointerDown={e => { e.stopPropagation(); onPalletPointerDown(e, pallet); }}
        style={{ fontSize:10, fontWeight:900, fontFamily:'monospace',
          color: selected ? '#4f46e5' : '#7a6b5a', marginBottom:5,
          cursor:'grab', userSelect:'none', letterSpacing:'.04em' }}>
        {pallet.code}
      </div>

      {/* ── Pallet body (perspective tilt) ── */}
      <div style={{ perspective:360, perspectiveOrigin:'50% -20%' }}>
        <div style={{ transform:'rotateX(32deg)', transformStyle:'preserve-3d', transformOrigin:'bottom center' }}>

          {/* Top deck surface with boxes */}
          <div style={{ width:138, position:'relative', borderRadius:'3px 3px 0 0',
            background:'repeating-linear-gradient(90deg, #c89838 0px, #bd8d35 12px, #7a5020 12px, #7a5020 13.5px, #c89838 13.5px)',
            border:'2px solid #8a5c20', borderBottom:'none',
            padding:'6px 6px 4px', boxShadow:'inset 0 2px 0 rgba(255,255,255,.22)' }}>
            {/* Vertical deck plank separators */}
            {[0.33, 0.66].map(p =>
              <div key={p} style={{ position:'absolute', top:4, bottom:3, left:`${p*100}%`, width:1,
                background:'rgba(0,0,0,.16)', pointerEvents:'none', zIndex:2 }} />
            )}
            {/* Box grid */}
            <div style={{ display:'grid', gridTemplateColumns:`repeat(${BOX_COLS},1fr)`, gridTemplateRows:`repeat(${BOX_ROWS},1fr)`,
              gap:2.5, width:122, height:82, position:'relative', zIndex:3 }}>
              {Array.from({ length: MAX_BOXES }, (_, i) => {
                const box = pallet.boxes[i];
                return box ? (
                  <MiniBox key={box.id} box={box} isDragging={dragBoxId === box.id}
                    onPointerDown={e => onBoxPointerDown(e, box, pallet)} />
                ) : (
                  <div key={`e${i}`} style={{ borderRadius:2, background:'rgba(0,0,0,.055)',
                    border:'0.5px dashed rgba(0,0,0,.1)' }} />
                );
              })}
            </div>
          </div>

          {/* Middle: stringers + forklift slots */}
          <div style={{ width:138, height:18, display:'flex',
            border:'2px solid #7a5020', borderTop:'none', borderBottom:'none' }}>
            <div style={{ flex:1.3, background:'linear-gradient(180deg,#9a7028,#7a5018)' }} />
            <div style={{ flex:2.2, background:'#c8b898', borderLeft:'2px solid #a08040', borderRight:'2px solid #a08040',
              boxShadow:'inset 0 4px 6px rgba(0,0,0,.18)' }} />
            <div style={{ flex:1, background:'linear-gradient(180deg,#9a7028,#7a5018)' }} />
            <div style={{ flex:2.2, background:'#c8b898', borderLeft:'2px solid #a08040', borderRight:'2px solid #a08040',
              boxShadow:'inset 0 4px 6px rgba(0,0,0,.18)' }} />
            <div style={{ flex:1.3, background:'linear-gradient(180deg,#9a7028,#7a5018)' }} />
          </div>

          {/* Bottom deck */}
          <div style={{ width:138, height:10, position:'relative', overflow:'hidden',
            background:'repeating-linear-gradient(90deg, #907028 0px, #887028 12px, #6a4818 12px, #6a4818 13.5px, #907028 13.5px)',
            border:'2px solid #6a4818', borderTop:'none', borderRadius:'0 0 3px 3px',
            boxShadow:'0 6px 16px rgba(0,0,0,.22)' }}>
            <div style={{ position:'absolute', inset:0, background:'linear-gradient(180deg, rgba(0,0,0,.1), transparent 50%)' }} />
          </div>
        </div>
      </div>

      {/* Fill bar */}
      <div style={{ width:138, marginTop:7 }}>
        <div style={{ height:3.5, background:'#ddd8d0', borderRadius:3, overflow:'hidden' }}>
          <div style={{ height:'100%', width:`${pct*100}%`, borderRadius:3, transition:'width .3s',
            background: pct > .8 ? '#16a34a' : pct > .4 ? '#ca8a04' : '#94a3b8' }} />
        </div>
        <div style={{ fontSize:8, fontFamily:'monospace', color:'#bbb', textAlign:'center', marginTop:3 }}>
          {fill}/{MAX_BOXES}
        </div>
      </div>
    </div>
  );
}

// ─── Drag ghost ────────────────────────────────────────────────────────────────
function DragGhost({ drag, canDrop, pallets }) {
  if (!drag) return null;
  if (drag.mode === 'pallet') {
    const p = pallets.find(p => p.id === drag.fromPalletId);
    return (
      <div style={{ position:'fixed', left:drag.ghostX-55, top:drag.ghostY-18, zIndex:9999, pointerEvents:'none',
        opacity:.88, background:'#fef3c7', border:`2px solid ${canDrop?'#c8a040':'#ef4444'}`,
        borderRadius:8, padding:'4px 14px', fontFamily:'monospace', fontWeight:900, fontSize:14,
        color:'#92400e', boxShadow:'0 8px 24px rgba(0,0,0,.2)', transform:'rotate(-2deg)' }}>
        📦 {p?.code}
      </div>
    );
  }
  const c = drag.box?.product?.color || '#c07830';
  return (
    <div style={{ position:'fixed', left:drag.ghostX-28, top:drag.ghostY-28, width:56, height:56,
      zIndex:9999, pointerEvents:'none', borderRadius:10,
      background: canDrop ? lighten(c,.38) : '#fee2e2',
      border:`2.5px solid ${canDrop ? c : '#ef4444'}`,
      boxShadow:`0 12px 30px rgba(0,0,0,.25), 0 0 0 6px ${canDrop ? rgba(c,.16) : 'rgba(239,68,68,.1)'}`,
      display:'flex', alignItems:'center', justifyContent:'center' }}>
      <div style={{ width:34, height:34, borderRadius:5, background:c,
        boxShadow:'inset 0 1px 0 rgba(255,255,255,.35)', display:'flex', alignItems:'center', justifyContent:'center' }}>
        <div style={{ width:20, height:20, border:'2px solid rgba(255,255,255,.35)', borderRadius:2 }} />
      </div>
      {!canDrop && drag.targetPalletId && (
        <div style={{ position:'absolute', top:-22, left:'50%', transform:'translateX(-50%)',
          whiteSpace:'nowrap', fontSize:9, fontWeight:700, color:'#ef4444',
          background:'#fff', padding:'2px 7px', borderRadius:6, border:'1px solid #fca5a5' }}>
          Заполнен
        </div>
      )}
    </div>
  );
}

// ─── Main ──────────────────────────────────────────────────────────────────────
export default function PalletWarehouseView() {
  const [pallets,   setPallets]   = useState(generateData);
  const [selected,  setSelected]  = useState(null);
  const [activeBox, setActiveBox] = useState(null);
  const [drag,      setDrag]      = useState(null);
  const [transferBoxId, setTransferBoxId] = useState(null);
  const dropRef = useRef(null);
  const transferRef = useRef(null);

  useEffect(() => {
    if (selected) setSelected(pallets.find(p => p.id === selected.id) || null);
  }, [pallets]);

  // Close transfer popup on outside click
  useEffect(() => {
    if (!transferBoxId) return;
    const handler = e => { if (transferRef.current && !transferRef.current.contains(e.target)) setTransferBoxId(null); };
    document.addEventListener('pointerdown', handler);
    return () => document.removeEventListener('pointerdown', handler);
  }, [transferBoxId]);

  const moveBox = useCallback((boxId, fromId, toId) => {
    setPallets(prev => {
      const moved = prev.find(p => p.id === fromId)?.boxes.find(b => b.id === boxId);
      if (!moved) return prev;
      if (fromId === toId) {
        return prev.map(p => { if (p.id !== fromId) return p; const a = p.boxes.filter(b => b.id !== boxId); a.push(moved); return { ...p, boxes: a }; });
      }
      const tgt = prev.find(p => p.id === toId);
      if (!tgt || tgt.boxes.length >= MAX_BOXES) return prev;
      return prev.map(p => {
        if (p.id === fromId) return { ...p, boxes: p.boxes.filter(b => b.id !== boxId) };
        if (p.id === toId)   return { ...p, boxes: [...p.boxes, moved] };
        return p;
      });
    });
  }, []);

  const swapPallets = useCallback((idA, idB) => {
    setPallets(prev => {
      const iA = prev.findIndex(p => p.id === idA), iB = prev.findIndex(p => p.id === idB);
      if (iA < 0 || iB < 0) return prev;
      const arr = [...prev];
      const mk = (src, dst) => ({ ...src, row: dst.row, col: dst.col, code: dst.code, barcode_value: dst.barcode_value });
      const tmp = arr[iA];
      arr[iA] = mk(arr[iB], arr[iA]);
      arr[iB] = mk(tmp, arr[iB]);
      return arr;
    });
  }, []);

  const startBoxDrag    = useCallback((e, box, pallet) => { e.preventDefault(); setDrag({ mode:'box',    boxId:box.id, fromPalletId:pallet.id, box,    ghostX:e.clientX, ghostY:e.clientY, targetPalletId:null }); }, []);
  const startPalletDrag = useCallback((e, pallet)      => { e.preventDefault(); setDrag({ mode:'pallet', fromPalletId:pallet.id,               ghostX:e.clientX, ghostY:e.clientY, targetPalletId:null }); }, []);

  useEffect(() => {
    if (!drag) return;
    const onMove = e => {
      const el  = document.elementFromPoint(e.clientX, e.clientY);
      const pel = el?.closest('[data-pallet-id]');
      let tgt   = pel ? +pel.dataset.palletId : null;
      if (drag.mode === 'pallet' && tgt === drag.fromPalletId) tgt = null;
      dropRef.current = tgt;
      setDrag(d => d ? { ...d, ghostX:e.clientX, ghostY:e.clientY, targetPalletId:tgt } : null);
    };
    const onUp = () => {
      const t = dropRef.current;
      if (t) {
        if (drag.mode === 'box')    moveBox(drag.boxId, drag.fromPalletId, t);
        if (drag.mode === 'pallet') swapPallets(drag.fromPalletId, t);
      }
      setDrag(null); dropRef.current = null; document.body.style.cursor = '';
    };
    document.body.style.cursor = 'grabbing';
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup',   onUp);
    return () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); document.body.style.cursor = ''; };
  }, [drag?.boxId, drag?.fromPalletId, drag?.mode]);

  const warehouseRows = Array.from({ length: ROWS }, (_, ri) => pallets.filter(p => p.row === ri + 1));
  const tgtPallet = drag?.targetPalletId ? pallets.find(p => p.id === drag.targetPalletId) : null;
  const canDrop   = drag?.mode === 'pallet' ? !!tgtPallet : tgtPallet && tgtPallet.boxes.length < MAX_BOXES;

  return (
    <div style={{ background:'#fff', borderRadius:12, overflow:'hidden', display:'flex', flexDirection:'column',
      minHeight:620, border:'1px solid #e5e7eb', boxShadow:'0 4px 24px rgba(0,0,0,.07)' }}>

      {/* ── Toolbar ── */}
      <div style={{ padding:'10px 18px', borderBottom:'1px solid #f0ede8', display:'flex', alignItems:'center',
        gap:14, background:'#faf9f7', flexWrap:'wrap' }}>
        <div style={{ display:'flex', gap:12, alignItems:'center', flexWrap:'wrap' }}>
          {Object.entries(CAT).map(([k, { color, label }]) => (
            <div key={k} style={{ display:'flex', alignItems:'center', gap:5 }}>
              <div style={{ width:11, height:11, borderRadius:2, background:color, boxShadow:`0 1px 3px ${rgba(color,.4)}` }} />
              <span style={{ fontSize:10, color:'#a09080' }}>{label}</span>
            </div>
          ))}
        </div>
        <div style={{ marginLeft:'auto', fontSize:10, color:'#c4b9ac', display:'flex', gap:10 }}>
          <span>Перетащить коробку → другой паллет</span>
          <span>·</span>
          <span>Перетащить заголовок → переставить паллет</span>
        </div>
      </div>

      {/* ── Body ── */}
      <div style={{ display:'flex', flex:1, overflow:'hidden' }}>

        {/* Warehouse floor */}
        <div style={{ flex:1, overflowY:'auto', overflowX:'auto', padding:'28px 28px 36px',
          background:'#f2efe9',
          backgroundImage:'radial-gradient(circle, rgba(0,0,0,.045) 1px, transparent 1px)',
          backgroundSize:'28px 28px' }}>

          {warehouseRows.map((rowPallets, ri) => (
            <div key={ri} style={{ display:'flex', alignItems:'flex-start', gap:0, marginBottom:44 }}>
              {/* Row label */}
              <div style={{ width:52, flexShrink:0, paddingTop:14, paddingRight:12, textAlign:'right' }}>
                <span style={{ fontSize:10, fontWeight:800, fontFamily:'monospace', color:'#c4b9ac',
                  textTransform:'uppercase', letterSpacing:'.08em', writingMode:'horizontal-tb' }}>
                  РЯД {ri + 1}
                </span>
              </div>
              {/* Row separator line */}
              <div style={{ width:2, alignSelf:'stretch', background:'rgba(0,0,0,.06)', borderRadius:2, marginRight:20, marginTop:10 }} />
              {/* Pallets */}
              <div style={{ display:'flex', gap:24, flexWrap:'wrap' }}>
                {rowPallets.map(p => (
                  <FloorPallet key={p.id} pallet={p}
                    selected={selected?.id === p.id}
                    isDragOver={drag?.targetPalletId === p.id}
                    canDrop={p.boxes.length < MAX_BOXES}
                    dragBoxId={drag?.mode === 'box' ? drag.boxId : null}
                    onBoxPointerDown={startBoxDrag}
                    onPalletPointerDown={startPalletDrag}
                    onClick={() => { if (drag) return; setSelected(s => s?.id === p.id ? null : p); setActiveBox(null); }}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* ── Detail panel ── */}
        {selected && (
          <div style={{ width:380, flexShrink:0, borderLeft:'1px solid #ece8e2',
            background:'#faf9f7', display:'flex', flexDirection:'column', overflow:'hidden' }}>

            {/* Panel header */}
            <div style={{ padding:'13px 16px', borderBottom:'1px solid #ece8e2',
              background:'#fff', display:'flex', alignItems:'center', gap:10 }}>
              <div style={{ flex:1, minWidth:0, display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
                <span style={{ fontSize:19, fontWeight:900, color:'#1c1917', fontFamily:'monospace' }}>
                  {selected.code}
                </span>
                <span style={{ fontSize:9, fontFamily:'monospace', color:'#a09080',
                  background:'#f5f0e8', padding:'2px 8px', borderRadius:99, border:'1px solid #e5e0d8' }}>
                  {selected.barcode_value}
                </span>
                <span style={{ fontSize:10, fontWeight:700, padding:'2px 8px', borderRadius:99,
                  border:'1px solid currentColor',
                  color: selected.boxes.length === 0 ? '#bbb' : selected.boxes.length >= MAX_BOXES ? '#16a34a' : '#ca8a04',
                  background: selected.boxes.length === 0 ? '#f9f9f9' : selected.boxes.length >= MAX_BOXES ? '#f0fdf4' : '#fefce8' }}>
                  {selected.boxes.length} / {MAX_BOXES}
                </span>
              </div>
              <button onClick={() => setSelected(null)}
                style={{ width:28, height:28, background:'transparent', border:'1px solid #e5e0d8',
                  borderRadius:6, color:'#bbb', cursor:'pointer', fontSize:16, lineHeight:1,
                  display:'flex', alignItems:'center', justifyContent:'center' }}>×</button>
            </div>

            {/* Panel body */}
            <div style={{ flex:1, overflowY:'auto', padding:'18px 16px 28px' }}>

              {selected.boxes.length > 0 ? (
                <>
                  <p style={{ fontSize:9, fontWeight:800, color:'#a09080', letterSpacing:'.15em',
                    textTransform:'uppercase', margin:'0 0 12px' }}>Содержимое паллета</p>
                  <div style={{ overflowX:'auto', paddingBottom:8 }}>
                    <PalletDetailView pallet={selected} activeBoxId={activeBox?.id}
                      onBoxClick={b => setActiveBox(a => a?.id === b.id ? null : b)} />
                  </div>

                  <p style={{ fontSize:9, fontWeight:800, color:'#a09080', letterSpacing:'.15em',
                    textTransform:'uppercase', margin:'22px 0 8px' }}>
                    Список коробок ({selected.boxes.length})
                  </p>
                  <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
                    {selected.boxes.map((box, i) => (
                      <div key={box.id} style={{ position:'relative' }}>
                        <div onClick={() => setActiveBox(a => a?.id === box.id ? null : box)}
                          style={{ display:'flex', alignItems:'center', gap:10, padding:'7px 10px',
                            borderRadius:8, cursor:'pointer', transition:'all .12s',
                            background: activeBox?.id === box.id ? lighten(box.product?.color||'#b87830',.87) : '#fff',
                            border:`1px solid ${activeBox?.id === box.id ? (box.product?.color||'#b87830')+'55' : '#eee'}`,
                            boxShadow: activeBox?.id === box.id ? `0 2px 8px ${rgba(box.product?.color||'#b87830',.14)}` : '0 1px 3px rgba(0,0,0,.05)' }}>
                          <div style={{ width:26, height:26, flexShrink:0, borderRadius:5,
                            background: box.product?.color||'#c07830',
                            display:'flex', alignItems:'center', justifyContent:'center',
                            boxShadow:`inset 0 1px 0 rgba(255,255,255,.3)` }}>
                            <span style={{ fontSize:9, fontWeight:900, fontFamily:FONT, color:'#fff' }}>{i+1}</span>
                          </div>
                          <div style={{ flex:1, minWidth:0 }}>
                            <p style={{ fontSize:11, fontWeight:700, fontFamily:FONT, color:'#1c1917',
                              margin:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                              {box.product?.name||'—'}
                            </p>
                            <p style={{ fontSize:9, fontFamily:'monospace', color:'#c4b9ac', margin:0 }}>
                              {box.barcode_value}
                            </p>
                          </div>
                          <span style={{ fontSize:11, fontFamily:FONT, fontWeight:600, color:'#888', flexShrink:0 }}>
                            {box.qty} шт.
                          </span>
                          {/* Transfer button */}
                          <button onClick={e => { e.stopPropagation(); setTransferBoxId(transferBoxId === box.id ? null : box.id); }}
                            title="Перенести на другой паллет"
                            style={{ width:24, height:24, flexShrink:0, border:'1px solid #e0dbd4', borderRadius:5,
                              background: transferBoxId === box.id ? '#e5e7eb' : '#f3f0ec', cursor:'pointer',
                              display:'flex', alignItems:'center', justifyContent:'center',
                              color:'#a09080', fontSize:12, lineHeight:1, transition:'background .1s' }}>
                            ↗
                          </button>
                        </div>
                        {/* Transfer dropdown */}
                        {transferBoxId === box.id && (
                          <div ref={transferRef} style={{ position:'absolute', right:0, top:'100%', zIndex:50,
                            marginTop:4, background:'#fff', border:'1px solid #e5e0d8', borderRadius:8,
                            boxShadow:'0 8px 24px rgba(0,0,0,.15)', padding:'6px 0', minWidth:180, maxHeight:220, overflowY:'auto' }}>
                            <p style={{ fontSize:9, fontWeight:800, color:'#a09080', letterSpacing:'.1em',
                              textTransform:'uppercase', margin:'2px 10px 6px', userSelect:'none' }}>Перенести на:</p>
                            {pallets.filter(p => p.id !== selected.id).map(p => {
                              const full = p.boxes.length >= MAX_BOXES;
                              return (
                                <div key={p.id} onClick={() => { if (full) return; moveBox(box.id, selected.id, p.id); setTransferBoxId(null); }}
                                  style={{ padding:'5px 12px', cursor: full ? 'not-allowed' : 'pointer', display:'flex', alignItems:'center', gap:8,
                                    opacity: full ? 0.4 : 1, transition:'background .08s',
                                    background: full ? 'transparent' : undefined }}
                                  onMouseEnter={e => { if (!full) e.currentTarget.style.background='#f5f0e8'; }}
                                  onMouseLeave={e => { e.currentTarget.style.background='transparent'; }}>
                                  <span style={{ fontSize:11, fontWeight:700, fontFamily:'monospace', color:'#1c1917' }}>{p.code}</span>
                                  <span style={{ fontSize:9, color:'#bbb', fontFamily:'monospace' }}>{p.boxes.length}/{MAX_BOXES}</span>
                                  {full && <span style={{ fontSize:8, color:'#ef4444', fontWeight:600 }}>полный</span>}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div style={{ padding:'50px 0', textAlign:'center' }}>
                  <div style={{ fontSize:42, marginBottom:12 }}>📦</div>
                  <p style={{ fontSize:13, fontFamily:FONT, color:'#ccc', margin:0 }}>Паллет пустой</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <DragGhost drag={drag} canDrop={canDrop} pallets={pallets} />
    </div>
  );
}
