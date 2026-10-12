import { useState, useCallback, useRef, useEffect } from 'react';
import { ChevronLeft, ChevronRight, RotateCcw, Clock } from 'lucide-react';
import api from '../../api/client';
import Spinner from '../ui/Spinner';

const PER_PAGE = 3;
const POLE     = 13;

// ─── BarcodeSVG (identical to WarehousePage) ──────────────────────────────────
function BarcodeSVG({ value, height = 22 }) {
  let s = (value||'X').split('').reduce((a, c, i) => (a + c.charCodeAt(0) * (i + 1)) & 0xffff, 0);
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
      <text x={tw/2} y={height-0.5} textAnchor="middle" fontSize={Math.max(3.5,height*0.2)} fill="#222" fontFamily="monospace">{value}</text>
    </svg>
  );
}

// ─── BoxFace (identical to old VisualWarehouseView) ───────────────────────────
function BoxFace({ name, code }) {
  return (
    <>
      <div style={{ height:8, margin:'0 4px', background:'linear-gradient(135deg,#c8a03c 0%,#9e7625 100%)', borderRadius:'2px 2px 0 0' }} />
      <div style={{
        background:'linear-gradient(180deg,#edbe62 0%,#d4a63e 55%,#c08e2c 100%)',
        border:'1px solid #b87e28', borderTop:'none', borderRadius:'0 0 3px 3px',
        padding:'4px 3px 4px', minHeight:82,
        display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'space-between',
        position:'relative', overflow:'hidden', gap:3,
      }}>
        <div style={{ position:'absolute',top:0,left:0,right:0,height:3,background:'rgba(155,105,15,.3)' }} />
        <p style={{
          fontSize:9, fontWeight:900, color:'#4a2e08',
          fontFamily:'sans-serif', textAlign:'center', lineHeight:1.3, width:'100%',
          overflow:'hidden', display:'-webkit-box', WebkitLineClamp:3, WebkitBoxOrient:'vertical',
          textTransform:'uppercase', letterSpacing:'-.2px', marginTop:2, flexShrink:0,
        }}>
          {name}
        </p>
        <div style={{ width:'100%', height:1, background:'rgba(100,55,0,.18)', flexShrink:0 }} />
        <div style={{
          background:'white', border:'1px solid #ccc', borderRadius:1,
          padding:'0px 3px', display:'flex', alignItems:'center',
          height:9, width:'60%', flexShrink:0, overflow:'hidden', alignSelf:'flex-start',
        }}>
          <div style={{ width:'100%', height:6, overflow:'hidden', lineHeight:0 }}>
            <BarcodeSVG value={code||'X'} height={6} />
          </div>
        </div>
      </div>
      <div style={{
        position:'absolute', top:8, right:-3, bottom:3, width:4,
        background:'linear-gradient(90deg,rgba(0,0,0,.18),transparent)',
        borderRadius:'0 2px 2px 0', pointerEvents:'none',
      }} />
    </>
  );
}

// ─── ItemBox wrapper (flex:1, draggable) ──────────────────────────────────────
function ItemBox({ item, isDragging, onPointerDown }) {
  return (
    <div
      data-item-key={`${item.product_id}:${item.shelf_id}`}
      onPointerDown={e => { e.preventDefault(); onPointerDown(e); }}
      style={{
        flex:1, cursor: isDragging ? 'grabbing' : 'grab',
        userSelect:'none', position:'relative',
        opacity: isDragging ? 0.12 : 1,
        transition:'opacity .15s',
        filter:'drop-shadow(1px 3px 4px rgba(0,0,0,.2))',
      }}
    >
      <BoxFace name={item.product_name} code={item.product_code} />
    </div>
  );
}

// ─── Metal rack column (identical style to old RackVisual) ────────────────────
function RackColumn({ rack, drag, onItemPointerDown }) {
  const shelves = [...(rack.shelves || [])].reverse(); // bottom to top
  return (
    <div style={{ display:'flex', flexDirection:'column', flex:1, minWidth:0 }}>
      <div style={{
        background:'linear-gradient(180deg,#d4d8e0,#c0c4cc)', color:'#444', textAlign:'center',
        padding:'3px 0', fontSize:11, fontWeight:800, letterSpacing:'.12em',
        borderRadius:'4px 4px 0 0', border:'1px solid #b8bcc6', borderBottom:'none',
        boxShadow:'inset 0 1px 0 rgba(255,255,255,.7)',
      }}>
        {rack.code}
      </div>
      <div style={{
        position:'relative', flex:1, background:'#f2f3f5',
        border:'1px solid #c0c4cc', borderTop:'none', boxShadow:'2px 6px 18px rgba(0,0,0,.13)',
      }}>
        {/* left pole */}
        <div style={{ position:'absolute',left:0,top:0,bottom:0,width:POLE,zIndex:2,
          background:'linear-gradient(90deg,#b8bcc6 0%,#dde0e6 45%,#eceef2 55%,#d4d8e0 100%)',
          borderRight:'1px solid #b0b4bc' }}>
          {Array.from({length:22},(_,i)=>(
            <div key={i} style={{ position:'absolute',left:3,right:3,top:4+i*11,height:4,background:'#a8acb6',borderRadius:1,boxShadow:'inset 0 1px 1px rgba(0,0,0,.3)' }}/>
          ))}
        </div>
        {/* right pole */}
        <div style={{ position:'absolute',right:0,top:0,bottom:0,width:POLE,zIndex:2,
          background:'linear-gradient(90deg,#d4d8e0 0%,#eceef2 45%,#dde0e6 55%,#b8bcc6 100%)',
          borderLeft:'1px solid #b0b4bc' }}>
          {Array.from({length:22},(_,i)=>(
            <div key={i} style={{ position:'absolute',left:3,right:3,top:4+i*11,height:4,background:'#a8acb6',borderRadius:1,boxShadow:'inset 0 1px 1px rgba(0,0,0,.3)' }}/>
          ))}
        </div>

        <div style={{ marginLeft:POLE, marginRight:POLE }}>
          {shelves.map(shelf => {
            const isHov = drag?.hoverShelfId === shelf.id;
            return (
              <div key={shelf.id}>
                {/* shelf beam with label + barcode */}
                <div style={{
                  height:11,
                  background:'linear-gradient(180deg,#e0e3ea 0%,#c8ccd4 40%,#a8acb8 100%)',
                  boxShadow:'0 3px 7px rgba(0,0,0,.18),inset 0 1px 0 rgba(255,255,255,.55)',
                  display:'flex', alignItems:'center', padding:'0 6px', gap:5,
                }}>
                  <div style={{ background:'white', border:'1px solid #bbb', borderRadius:1,
                    padding:'0px 3px', display:'flex', alignItems:'center', gap:3, height:8, flexShrink:0 }}>
                    <span style={{ fontSize:5.5, fontFamily:'monospace', fontWeight:800, color:'#333', lineHeight:1, whiteSpace:'nowrap' }}>{shelf.code}</span>
                    <div style={{ width:24, height:6, overflow:'hidden', lineHeight:0 }}>
                      <BarcodeSVG value={shelf.barcode_value||shelf.code} height={6} />
                    </div>
                  </div>
                </div>
                {/* shelf content */}
                <div data-shelf-id={shelf.id} style={{
                  display:'flex', gap:6, alignItems:'flex-end',
                  padding:'10px 6px 8px', minHeight:108,
                  background:isHov?'rgba(99,102,241,.05)':'transparent',
                  outline:isHov?'2px dashed rgba(99,102,241,.35)':'2px dashed transparent',
                  outlineOffset:-3, transition:'background .2s, outline .2s',
                }}>
                  {(shelf.items||[]).map(item => (
                    <ItemBox key={item.product_id} item={item}
                      isDragging={drag?.productId===item.product_id && drag?.fromShelfId===item.shelf_id}
                      onPointerDown={e => onItemPointerDown(e, item, shelf)} />
                  ))}
                  {(!shelf.items || shelf.items.length===0) && (
                    <div style={{ flex:1, height:76, border:'2px dashed #d0d3da', borderRadius:3,
                      display:'flex', alignItems:'center', justifyContent:'center' }}>
                      <span style={{ fontSize:10, color:'#bbb' }}>пусто</span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          <div style={{ height:10, background:'linear-gradient(180deg,#d0d4dc 0%,#9094a4 100%)', boxShadow:'0 4px 10px rgba(0,0,0,.22)' }} />
        </div>
      </div>
      <div style={{ display:'flex', justifyContent:'space-between', paddingLeft:POLE*.3, paddingRight:POLE*.3 }}>
        {[0,1].map(i=>(
          <div key={i} style={{ width:POLE, height:14, background:'linear-gradient(180deg,#b8bcc6,#80848e)', borderRadius:'0 0 3px 3px', boxShadow:'0 3px 6px rgba(0,0,0,.18)' }}/>
        ))}
      </div>
    </div>
  );
}

// ─── Data helpers ──────────────────────────────────────────────────────────────
function buildDraft(data) {
  return {
    ...data,
    racks: data.racks.map(rack => ({
      ...rack,
      shelves: rack.shelves.map(shelf => ({
        ...shelf,
        items: (shelf.items||[]).map(item => ({ ...item, shelf_id: shelf.id })),
      })),
    })),
  };
}

function applyMove(draft, productId, fromShelfId, toShelfId) {
  let moved = null;
  const step1 = {
    ...draft,
    racks: draft.racks.map(rack => ({
      ...rack,
      shelves: rack.shelves.map(shelf => {
        if (shelf.id !== fromShelfId) return shelf;
        const item = shelf.items.find(i => i.product_id === productId);
        if (item) moved = item;
        return { ...shelf, items: shelf.items.filter(i => i.product_id !== productId) };
      }),
    })),
  };
  if (!moved) return draft;
  return {
    ...step1,
    racks: step1.racks.map(rack => ({
      ...rack,
      shelves: rack.shelves.map(shelf => {
        if (shelf.id !== toShelfId) return shelf;
        const exist = shelf.items.find(i => i.product_id === productId);
        if (exist) {
          return { ...shelf, items: shelf.items.map(i => i.product_id===productId
            ? { ...i, quantity: Number(i.quantity)+Number(moved.quantity) } : i) };
        }
        return { ...shelf, items: [...shelf.items, { ...moved, shelf_id: toShelfId }] };
      }),
    })),
  };
}

function fmtDate(iso) {
  return new Date(iso).toLocaleString('ru-RU', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' });
}

// ─── Main ──────────────────────────────────────────────────────────────────────
export default function FBSVisualView({ warehouse }) {
  const [original,    setOriginal]    = useState(null);
  const [draft,       setDraft]       = useState(null);
  const [loading,     setLoading]     = useState(true);
  const [pending,     setPending]     = useState([]);
  const [history,     setHistory]     = useState([]);
  const [saving,      setSaving]      = useState(false);
  const [page,        setPage]        = useState(0);
  const [drag,        setDrag]        = useState(null);
  const [showHistory, setShowHistory] = useState(false);
  const dropRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get(`/warehouse/visual-fbs/${warehouse.id}`);
      const d = buildDraft(r.data);
      setOriginal(d); setDraft(d); setPending([]);
    } catch {} finally { setLoading(false); }
  }, [warehouse.id]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const s = document.createElement('style');
    s.id = 'fbs-vis-anim';
    s.textContent = `@keyframes fbs-wiggle{0%,100%{transform:rotate(0) scale(1)}20%{transform:rotate(-3deg) scale(1.05)}60%{transform:rotate(3deg) scale(1.05)}}`;
    document.head.appendChild(s);
    return () => document.getElementById('fbs-vis-anim')?.remove();
  }, []);

  const startDrag = useCallback((e, item, shelf) => {
    e.preventDefault();
    setDrag({ productId:item.product_id, fromShelfId:shelf.id, item, ghostX:e.clientX, ghostY:e.clientY, hoverShelfId:null });
  }, []);

  useEffect(() => {
    if (!drag) return;
    const onMove = e => {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const shelfEl = el?.closest('[data-shelf-id]');
      const hoverShelfId = shelfEl ? +shelfEl.dataset.shelfId : null;
      dropRef.current = hoverShelfId;
      setDrag(d => d ? { ...d, ghostX:e.clientX, ghostY:e.clientY, hoverShelfId } : null);
    };
    const onUp = () => {
      const toId = dropRef.current;
      if (toId && toId !== drag.fromShelfId) {
        let fromCode='', toCode='';
        draft?.racks.forEach(r => r.shelves.forEach(s => {
          if (s.id===drag.fromShelfId) fromCode=s.code;
          if (s.id===toId) toCode=s.code;
        }));
        setDraft(prev => applyMove(prev, drag.productId, drag.fromShelfId, toId));
        setPending(prev => [...prev, {
          product_id:drag.productId, product_name:drag.item.product_name,
          quantity:drag.item.quantity,
          from_shelf_id:drag.fromShelfId, from_shelf_code:fromCode,
          to_shelf_id:toId, to_shelf_code:toCode,
        }]);
      }
      setDrag(null); dropRef.current=null; document.body.style.cursor='';
    };
    document.body.style.cursor='grabbing';
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => { window.removeEventListener('pointermove',onMove); window.removeEventListener('pointerup',onUp); document.body.style.cursor=''; };
  }, [drag?.productId, drag?.fromShelfId, draft]);

  const handleSave = async () => {
    setSaving(true);
    try {
      for (const m of pending) {
        await api.post('/warehouse/visual-fbs/move', {
          product_id:m.product_id, from_shelf_id:m.from_shelf_id,
          to_shelf_id:m.to_shelf_id, quantity:m.quantity,
        });
      }
      setHistory(prev => [{ id:Date.now(), savedAt:new Date().toISOString(), moves:[...pending] }, ...prev]);
      setPending([]);
      await load();
    } catch (err) { alert('Ошибка: '+(err.response?.data?.error||err.message)); }
    finally { setSaving(false); }
  };

  const handleCancel = () => { setDraft(original); setPending([]); };

  const handleUndo = async (entry) => {
    setSaving(true);
    try {
      for (const m of [...entry.moves].reverse()) {
        await api.post('/warehouse/visual-fbs/move', {
          product_id:m.product_id, from_shelf_id:m.to_shelf_id, to_shelf_id:m.from_shelf_id, quantity:m.quantity,
        });
      }
      setHistory(prev => prev.filter(h => h.id !== entry.id));
      await load();
    } catch (err) { alert('Ошибка отката: '+(err.response?.data?.error||err.message)); }
    finally { setSaving(false); }
  };

  if (loading) return <div style={{ display:'flex',alignItems:'center',justifyContent:'center',height:280 }}><Spinner size="lg" /></div>;

  const totalPages   = Math.ceil((draft?.racks.length||0) / PER_PAGE);
  const visibleRacks = (draft?.racks||[]).slice(page*PER_PAGE, (page+1)*PER_PAGE);

  return (
    <div>
      {/* pending bar */}
      {pending.length > 0 && (
        <div style={{ display:'flex',alignItems:'center',gap:12,padding:'11px 16px',marginBottom:14,
          background:'#fffbeb',border:'1.5px solid #fbbf24',borderRadius:10,
          boxShadow:'0 2px 8px rgba(251,191,36,.18)',flexWrap:'wrap' }}>
          <div style={{ flex:1,fontSize:13,fontWeight:600,color:'#92400e',minWidth:140 }}>
            {pending.length} {pending.length===1?'несохранённое перемещение':'несохранённых перемещений'}
          </div>
          <button onClick={handleCancel} style={{ padding:'5px 14px',borderRadius:7,border:'1px solid #e5e7eb',background:'#fff',fontSize:13,fontWeight:600,color:'#6b7280',cursor:'pointer' }}>Отмена</button>
          <button onClick={handleSave} disabled={saving} style={{ padding:'5px 20px',borderRadius:7,border:'none',background:'#16a34a',fontSize:13,fontWeight:700,color:'#fff',cursor:saving?'wait':'pointer',opacity:saving?.7:1 }}>
            {saving?'Сохранение...':'Сохранить'}
          </button>
        </div>
      )}

      {pending.length > 0 && (
        <div style={{ marginBottom:14,background:'#f9f7f4',border:'1px solid #e8e3dc',borderRadius:8,padding:'8px 12px',display:'flex',flexDirection:'column',gap:5 }}>
          {pending.map((m,i) => (
            <div key={i} style={{ fontSize:11,display:'flex',alignItems:'center',gap:7,color:'#6b7280' }}>
              <span style={{ fontWeight:700,color:'#1c1917',flex:1,minWidth:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap' }}>{m.product_name}</span>
              <span style={{ fontFamily:'monospace',color:'#ef4444',flexShrink:0 }}>{m.from_shelf_code}</span>
              <span style={{ color:'#bbb' }}>→</span>
              <span style={{ fontFamily:'monospace',color:'#16a34a',flexShrink:0 }}>{m.to_shelf_code}</span>
              <span style={{ color:'#bbb',flexShrink:0 }}>{Math.round(Number(m.quantity))} шт.</span>
            </div>
          ))}
        </div>
      )}

      {/* navigation */}
      <div style={{ display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:16 }}>
        <button onClick={()=>setPage(p=>Math.max(0,p-1))} disabled={page===0}
          className="p-2.5 rounded-xl border border-gray-200 text-gray-500 hover:border-gray-400 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed transition-all">
          <ChevronLeft size={20} />
        </button>
        <span style={{ fontSize:13,color:'#6b7280',fontWeight:500 }}>
          {page*PER_PAGE+1}–{Math.min((page+1)*PER_PAGE,draft?.racks.length||0)} из {draft?.racks.length||0} стеллажей
        </span>
        <button onClick={()=>setPage(p=>Math.min(totalPages-1,p+1))} disabled={page>=totalPages-1}
          className="p-2.5 rounded-xl border border-gray-200 text-gray-500 hover:border-gray-400 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed transition-all">
          <ChevronRight size={20} />
        </button>
      </div>

      <p style={{ fontSize:11,color:'#bbb',textAlign:'center',marginBottom:14 }}>Перетащите товар на другую полку — кнопка «Сохранить» появится сверху</p>

      <div style={{ display:'flex',gap:12,alignItems:'flex-start' }}>
        {visibleRacks.map(rack => (
          <RackColumn key={rack.id} rack={rack} drag={drag} onItemPointerDown={startDrag} />
        ))}
        {visibleRacks.length===0 && (
          <div style={{ flex:1,textAlign:'center',padding:60,color:'#bbb',fontSize:14 }}>Нет стеллажей</div>
        )}
      </div>

      {/* drag ghost */}
      {drag && (
        <div style={{ position:'fixed',left:drag.ghostX-36,top:drag.ghostY-62,width:72,
          zIndex:9999,pointerEvents:'none',
          transform:'rotate(0deg) scale(1.1)',
          transition:'transform 0.15s cubic-bezier(0.34,1.56,0.64,1)',
          filter:'drop-shadow(6px 16px 28px rgba(0,0,0,.65))' }}>
          <BoxFace name={drag.item?.product_name} code={drag.item?.product_code} />
        </div>
      )}

      {/* history */}
      {history.length > 0 && (
        <div style={{ marginTop:28 }}>
          <button onClick={()=>setShowHistory(h=>!h)}
            style={{ display:'flex',alignItems:'center',gap:6,fontSize:12,fontWeight:700,color:'#6b7280',background:'none',border:'none',cursor:'pointer',padding:'0 0 8px' }}>
            <Clock size={14} />
            История перемещений ({history.length})
            <ChevronRight size={13} style={{ transform:showHistory?'rotate(90deg)':'none',transition:'transform .15s' }} />
          </button>
          {showHistory && (
            <div style={{ background:'#f9f7f4',border:'1px solid #e8e3dc',borderRadius:10,overflow:'hidden' }}>
              {history.map((entry,hi) => (
                <div key={entry.id} style={{ padding:'10px 14px',borderBottom:hi<history.length-1?'1px solid #e8e3dc':'none',display:'flex',alignItems:'flex-start',gap:10 }}>
                  <div style={{ flex:1,minWidth:0 }}>
                    <div style={{ display:'flex',alignItems:'center',gap:8,marginBottom:4 }}>
                      <span style={{ fontSize:11,fontWeight:700,color:'#1c1917' }}>{fmtDate(entry.savedAt)}</span>
                      <span style={{ fontSize:10,color:'#bbb' }}>· {entry.moves.length} перемещений</span>
                    </div>
                    {entry.moves.map((m,mi) => (
                      <div key={mi} style={{ fontSize:10,color:'#9b8fa0',display:'flex',gap:5,alignItems:'center' }}>
                        <span style={{ overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',maxWidth:180 }}>{m.product_name}</span>
                        <span style={{ fontFamily:'monospace',color:'#ef9999',flexShrink:0 }}>{m.from_shelf_code}</span>
                        <span>→</span>
                        <span style={{ fontFamily:'monospace',color:'#86c068',flexShrink:0 }}>{m.to_shelf_code}</span>
                      </div>
                    ))}
                  </div>
                  <button onClick={()=>handleUndo(entry)} disabled={saving}
                    style={{ display:'flex',alignItems:'center',gap:4,padding:'4px 10px',borderRadius:6,border:'1px solid #e5e7eb',background:'#fff',fontSize:11,fontWeight:600,color:'#6b7280',cursor:saving?'wait':'pointer',flexShrink:0,whiteSpace:'nowrap' }}>
                    <RotateCcw size={11} /> Откатить
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
