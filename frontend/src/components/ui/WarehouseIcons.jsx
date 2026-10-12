// Warehouse entity icons v3 — realistic drawn style

// 10 color themes for warehouses — each warehouse gets a unique look
const WAREHOUSE_THEMES = [
  { wall: '#c7d2e0', wallStroke: '#8494a7', roof: '#7b8fa8', roofStroke: '#5c6f82', roofLight: '#9bafc4', door: '#5a7089', doorStroke: '#46586b', window: '#a3c4e8', windowStroke: '#7b9ab8' }, // серый (default)
  { wall: '#c7d0e8', wallStroke: '#7b8ab8', roof: '#6375a8', roofStroke: '#4a5a8a', roofLight: '#8b9fd0', door: '#4a6099', doorStroke: '#3a4e7a', window: '#a3b8e8', windowStroke: '#7090c0' }, // синий
  { wall: '#c7e8d0', wallStroke: '#6ba87b', roof: '#4a8a5e', roofStroke: '#3a7048', roofLight: '#7bc090', door: '#3a7050', doorStroke: '#2a5a3a', window: '#90d8a8', windowStroke: '#60b880' }, // зелёный
  { wall: '#e8c7c7', wallStroke: '#b87070', roof: '#a85050', roofStroke: '#883838', roofLight: '#d08080', door: '#904040', doorStroke: '#703030', window: '#e8a0a0', windowStroke: '#c07070' }, // красный
  { wall: '#e8dcc7', wallStroke: '#b89a60', roof: '#a88040', roofStroke: '#886828', roofLight: '#d0a860', door: '#907030', doorStroke: '#705820', window: '#e8d0a0', windowStroke: '#c0a060' }, // жёлтый/золотой
  { wall: '#dcc7e8', wallStroke: '#9070b8', roof: '#7850a8', roofStroke: '#603888', roofLight: '#a080d0', door: '#684099', doorStroke: '#503080', window: '#c8a0e8', windowStroke: '#a070c0' }, // фиолетовый
  { wall: '#c7e0e8', wallStroke: '#60a0b8', roof: '#4088a8', roofStroke: '#287088', roofLight: '#60b0d0', door: '#307090', doorStroke: '#205870', window: '#90d0e8', windowStroke: '#60b0c8' }, // бирюзовый
  { wall: '#e8d0c7', wallStroke: '#b87850', roof: '#a86038', roofStroke: '#884820', roofLight: '#d09060', door: '#905030', doorStroke: '#703820', window: '#e8b8a0', windowStroke: '#c09070' }, // оранжевый
  { wall: '#e0c7e8', wallStroke: '#a070b0', roof: '#8850a0', roofStroke: '#703888', roofLight: '#b080c8', door: '#784090', doorStroke: '#603070', window: '#d0a0e0', windowStroke: '#b070c0' }, // розовый
  { wall: '#c7e8e0', wallStroke: '#60b0a0', roof: '#409888', roofStroke: '#288070', roofLight: '#60c8b0', door: '#308070', doorStroke: '#206858', window: '#90e0d0', windowStroke: '#60c0b0' }, // мятный
];

export function WarehouseIcon({ size = 20, className = '', style, colorIndex }) {
  const t = WAREHOUSE_THEMES[(colorIndex ?? 0) % WAREHOUSE_THEMES.length];
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={className} style={style}>
      <rect x="6" y="18" width="36" height="24" rx="2" fill={t.wall} stroke={t.wallStroke} strokeWidth="1.5"/>
      <path d="M4 20L24 6l20 14" fill={t.roof} stroke={t.roofStroke} strokeWidth="1.5" strokeLinejoin="round"/>
      <path d="M4 20L24 10l20 10" fill={t.roofLight}/>
      <rect x="17" y="28" width="14" height="14" rx="1.5" fill={t.door} stroke={t.doorStroke} strokeWidth="1"/>
      <line x1="24" y1="28" x2="24" y2="42" stroke={t.doorStroke} strokeWidth=".8"/>
      <rect x="9" y="22" width="5" height="4" rx=".8" fill={t.window} stroke={t.windowStroke} strokeWidth=".8"/>
      <rect x="34" y="22" width="5" height="4" rx=".8" fill={t.window} stroke={t.windowStroke} strokeWidth=".8"/>
    </svg>
  );
}

export function RackIcon({ size = 20, className = '', style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={className} style={style}>
      <rect x="7" y="4" width="3" height="40" rx=".5" fill="#6ba87b" stroke="#4a7a58" strokeWidth=".8"/>
      <rect x="38" y="4" width="3" height="40" rx=".5" fill="#6ba87b" stroke="#4a7a58" strokeWidth=".8"/>
      <rect x="7" y="4" width="34" height="2.5" rx=".5" fill="#7bc090" stroke="#5a9a6a" strokeWidth=".8"/>
      <rect x="7" y="16" width="34" height="2.5" rx=".5" fill="#7bc090" stroke="#5a9a6a" strokeWidth=".8"/>
      <rect x="7" y="28" width="34" height="2.5" rx=".5" fill="#7bc090" stroke="#5a9a6a" strokeWidth=".8"/>
      <rect x="7" y="40" width="34" height="2.5" rx=".5" fill="#7bc090" stroke="#5a9a6a" strokeWidth=".8"/>
      <rect x="12" y="7" width="8" height="8.5" rx="1" fill="#d4a76a" stroke="#b8884a" strokeWidth=".8"/>
      <rect x="22" y="9" width="6" height="6.5" rx="1" fill="#c49558" stroke="#a87a3e" strokeWidth=".8"/>
      <rect x="30" y="8" width="7" height="7.5" rx="1" fill="#d4a76a" stroke="#b8884a" strokeWidth=".8"/>
      <rect x="11" y="19" width="10" height="8.5" rx="1" fill="#c49558" stroke="#a87a3e" strokeWidth=".8"/>
      <rect x="24" y="20" width="5" height="7.5" rx="1" fill="#d4a76a" stroke="#b8884a" strokeWidth=".8"/>
      <rect x="13" y="31" width="7" height="8.5" rx="1" fill="#d4a76a" stroke="#b8884a" strokeWidth=".8"/>
      <rect x="23" y="31" width="9" height="8.5" rx="1" fill="#c49558" stroke="#a87a3e" strokeWidth=".8"/>
    </svg>
  );
}

export function ShelfIcon({ size = 20, className = '', style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={className} style={style}>
      {/* полка доска */}
      <rect x="2" y="24" width="44" height="3" rx=".8" fill="#9a9a9a" stroke="#7a7a7a" strokeWidth="1"/>
      <rect x="2" y="24" width="44" height="1.2" rx=".5" fill="#b5b5b5" opacity=".5"/>
      {/* кронштейны */}
      <path d="M6 27v4l-2 2" stroke="#7a7a7a" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M42 27v4l2 2" stroke="#7a7a7a" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      {/* коробки на полке — одного цвета */}
      <rect x="5" y="10" width="9" height="14" rx="1.5" fill="#d4a76a" stroke="#b8884a" strokeWidth=".8"/>
      <line x1="9.5" y1="10" x2="9.5" y2="24" stroke="#b8884a" strokeWidth=".5" opacity=".3"/>
      <rect x="16" y="13" width="7" height="11" rx="1.2" fill="#c9985a" stroke="#a87a3e" strokeWidth=".8"/>
      <line x1="19.5" y1="13" x2="19.5" y2="24" stroke="#a87a3e" strokeWidth=".5" opacity=".3"/>
      <rect x="25" y="8" width="10" height="16" rx="1.5" fill="#d4a76a" stroke="#b8884a" strokeWidth=".8"/>
      <line x1="30" y1="8" x2="30" y2="24" stroke="#b8884a" strokeWidth=".5" opacity=".3"/>
      <rect x="37" y="15" width="6" height="9" rx="1" fill="#c9985a" stroke="#a87a3e" strokeWidth=".8"/>
    </svg>
  );
}

export function PalletIcon({ size = 20, className = '', style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={className} style={style}>
      {/* верхняя доска */}
      <rect x="3" y="12" width="42" height="4" rx="1" fill="#d4b05a" stroke="#a88520" strokeWidth="1"/>
      {/* ножки с дырками */}
      <rect x="6" y="16" width="5" height="10" rx="1" fill="#a07820" stroke="#8a7020" strokeWidth=".6"/>
      <rect x="21.5" y="16" width="5" height="10" rx="1" fill="#a07820" stroke="#8a7020" strokeWidth=".6"/>
      <rect x="37" y="16" width="5" height="10" rx="1" fill="#a07820" stroke="#8a7020" strokeWidth=".6"/>
      {/* нижняя доска */}
      <rect x="3" y="26" width="42" height="4" rx="1" fill="#d4b05a" stroke="#a88520" strokeWidth="1"/>
    </svg>
  );
}

export function RowIcon({ size = 20, className = '', style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={className} style={style}>
      <rect x="1" y="36" width="12" height="3" rx=".5" fill="#c49a40"/>
      <rect x="2" y="26" width="10" height="10" rx="1" fill="#d4a76a" stroke="#b8884a" strokeWidth=".7"/>
      <rect x="3" y="18" width="8" height="8" rx="1" fill="#c49558" stroke="#a87a3e" strokeWidth=".7"/>
      <rect x="16" y="36" width="14" height="3" rx=".5" fill="#c49a40"/>
      <rect x="17" y="22" width="12" height="14" rx="1" fill="#d4a76a" stroke="#b8884a" strokeWidth=".7"/>
      <rect x="18" y="10" width="10" height="12" rx="1" fill="#c49558" stroke="#a87a3e" strokeWidth=".7"/>
      <rect x="20" y="3" width="6" height="7" rx="1" fill="#d4a76a" stroke="#b8884a" strokeWidth=".7"/>
      <rect x="33" y="36" width="12" height="3" rx=".5" fill="#c49a40"/>
      <rect x="34" y="28" width="10" height="8" rx="1" fill="#c49558" stroke="#a87a3e" strokeWidth=".7"/>
      <rect x="35" y="20" width="8" height="8" rx="1" fill="#d4a76a" stroke="#b8884a" strokeWidth=".7"/>
      <path d="M5 44h38" stroke="#94a3b8" strokeWidth="1" strokeDasharray="3 2" opacity=".4"/>
    </svg>
  );
}

export function BoxIcon({ size = 20, className = '', style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={className} style={style}>
      <path d="M6 16L24 6l18 10v20L24 46 6 36V16z" fill="#d4a76a" stroke="#b8884a" strokeWidth="1.5" strokeLinejoin="round"/>
      <path d="M6 16l18 8 18-8" fill="#e8c888" stroke="#b8884a" strokeWidth="1" strokeLinejoin="round"/>
      <path d="M24 24v22" stroke="#b8884a" strokeWidth="1"/>
      <path d="M24 24l18-8v20L24 46z" fill="#c49558"/>
      <path d="M18 13l6 3 6-3" stroke="#e8d8a0" strokeWidth="2.5" strokeLinecap="round" opacity=".7"/>
      <line x1="24" y1="24" x2="24" y2="38" stroke="#e8d8a0" strokeWidth="2" opacity=".5"/>
      <rect x="14" y="28" width="8" height="6" rx=".5" fill="white" opacity=".6"/>
    </svg>
  );
}

export function ProductIcon({ size = 20, className = '', style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={className} style={style}>
      {/* Банка — белый корпус */}
      <rect x="13" y="7" width="22" height="35" rx="5" fill="#f8f8f6" stroke="#d4d0c8" strokeWidth="1.3"/>
      {/* Крышка — золотая */}
      <rect x="15" y="4" width="18" height="6" rx="3" fill="#c9a94e" stroke="#b08d30" strokeWidth="1"/>
      <rect x="17" y="5.5" width="14" height="2.5" rx="1" fill="#dfc065" opacity=".6"/>
      {/* Дно — золотое */}
      <rect x="15" y="39" width="18" height="4" rx="2" fill="#c9a94e" stroke="#b08d30" strokeWidth="1"/>
      {/* Этикетка */}
      <rect x="15" y="15" width="18" height="18" rx="1.5" fill="white" stroke="#e8e0c8" strokeWidth=".8"/>
      {/* Золотая полоска сверху этикетки */}
      <rect x="15" y="15" width="18" height="3.5" rx="1" fill="#c9a94e" opacity=".8"/>
      {/* Текст GRA */}
      <text x="24" y="17.5" textAnchor="middle" fill="white" fontSize="3" fontWeight="800" fontFamily="sans-serif">GRAFLab</text>
      {/* Текст на этикетке */}
      <rect x="17" y="21" width="14" height="1.5" rx=".4" fill="#b08d30" opacity=".35"/>
      <rect x="17" y="24" width="10" height="1.2" rx=".4" fill="#c9a94e" opacity=".25"/>
      <rect x="17" y="26.5" width="12" height="1.2" rx=".4" fill="#c9a94e" opacity=".2"/>
      <rect x="17" y="29" width="8" height="1.2" rx=".4" fill="#d4d0c8" opacity=".3"/>
      {/* Блик на банке */}
      <path d="M31 10v28" stroke="white" strokeWidth="2" opacity=".35" strokeLinecap="round"/>
      <path d="M29 12v24" stroke="white" strokeWidth=".8" opacity=".15" strokeLinecap="round"/>
    </svg>
  );
}

export function ScanIcon({ size = 20, className = '', style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={className} style={style}>
      <path d="M6 14V6h8" stroke="#4f46e5" strokeWidth="2.5" strokeLinecap="round"/>
      <path d="M42 14V6h-8" stroke="#4f46e5" strokeWidth="2.5" strokeLinecap="round"/>
      <path d="M6 34v8h8" stroke="#4f46e5" strokeWidth="2.5" strokeLinecap="round"/>
      <path d="M42 34v8h-8" stroke="#4f46e5" strokeWidth="2.5" strokeLinecap="round"/>
      <rect x="12" y="14" width="3" height="20" rx=".3" fill="#1e293b" opacity=".85"/>
      <rect x="16.5" y="12" width="2" height="24" rx=".3" fill="#1e293b" opacity=".6"/>
      <rect x="20" y="14" width="4" height="20" rx=".3" fill="#1e293b" opacity=".85"/>
      <rect x="25.5" y="12" width="1.5" height="24" rx=".3" fill="#1e293b" opacity=".5"/>
      <rect x="28.5" y="14" width="3" height="20" rx=".3" fill="#1e293b" opacity=".75"/>
      <rect x="33" y="12" width="2" height="24" rx=".3" fill="#1e293b" opacity=".6"/>
      <rect x="36.5" y="14" width="1.5" height="20" rx=".3" fill="#1e293b" opacity=".4"/>
      <line x1="8" y1="24" x2="40" y2="24" stroke="#ef4444" strokeWidth="2" opacity=".7"/>
    </svg>
  );
}

export function EmployeeIcon({ size = 20, className = '', style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={className} style={style}>
      <path d="M24 26c-8 0-15 4-15 10v4h30v-4c0-6-7-10-15-10z" fill="#6366f1" opacity=".15" stroke="#6366f1" strokeWidth="1.5"/>
      <circle cx="24" cy="15" r="9" fill="#fcd9b6" stroke="#e4a96a" strokeWidth="1.3"/>
      <path d="M15 13c0-6 4-9 9-9s9 3 9 9" fill="#5a3e28" opacity=".8"/>
      <circle cx="20.5" cy="15.5" r="1.2" fill="#3a3a3a"/>
      <circle cx="27.5" cy="15.5" r="1.2" fill="#3a3a3a"/>
      <path d="M21 19.5c1.5 1.5 4.5 1.5 6 0" stroke="#c47a4a" strokeWidth="1" strokeLinecap="round" fill="none"/>
      <rect x="20" y="30" width="8" height="5" rx="1" fill="white" stroke="#6366f1" strokeWidth=".8"/>
    </svg>
  );
}

export function BundleIcon({ size = 20, className = '', style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={className} style={style}>
      {/* банка левая наклон */}
      <g transform="rotate(-8 14 24)">
        <rect x="4" y="10" width="16" height="28" rx="3.5" fill="#f0efe8" stroke="#d4d0c8" strokeWidth="1"/>
        <rect x="6" y="8" width="12" height="4" rx="2" fill="#c9a94e" stroke="#b08d30" strokeWidth=".7"/>
        <rect x="6" y="35" width="12" height="3" rx="1.5" fill="#c9a94e"/>
        <rect x="6" y="16" width="12" height="12" rx="1" fill="white" stroke="#e8e0c8" strokeWidth=".5"/>
        <rect x="6" y="16" width="12" height="2.5" rx=".6" fill="#c9a94e" opacity=".7"/>
      </g>
      {/* банка центральная */}
      <rect x="14" y="6" width="20" height="34" rx="4.5" fill="#f8f8f6" stroke="#d4d0c8" strokeWidth="1.3"/>
      <rect x="16" y="3.5" width="16" height="5.5" rx="2.8" fill="#c9a94e" stroke="#b08d30" strokeWidth="1"/>
      <rect x="16" y="37" width="16" height="4" rx="2" fill="#c9a94e" stroke="#b08d30" strokeWidth="1"/>
      <rect x="16" y="14" width="16" height="16" rx="1.2" fill="white" stroke="#e8e0c8" strokeWidth=".7"/>
      <rect x="16" y="14" width="16" height="3.2" rx=".8" fill="#c9a94e" opacity=".8"/>
      <path d="M30 9v28" stroke="white" strokeWidth="1.5" opacity=".3" strokeLinecap="round"/>
      {/* банка правая наклон */}
      <g transform="rotate(8 34 24)">
        <rect x="28" y="10" width="16" height="28" rx="3.5" fill="#f0efe8" stroke="#d4d0c8" strokeWidth="1"/>
        <rect x="30" y="8" width="12" height="4" rx="2" fill="#c9a94e" stroke="#b08d30" strokeWidth=".7"/>
        <rect x="30" y="35" width="12" height="3" rx="1.5" fill="#c9a94e"/>
        <rect x="30" y="16" width="12" height="12" rx="1" fill="white" stroke="#e8e0c8" strokeWidth=".5"/>
        <rect x="30" y="16" width="12" height="2.5" rx=".6" fill="#c9a94e" opacity=".7"/>
      </g>
      {/* бейдж */}
      <circle cx="42" cy="8" r="6" fill="#c9a94e" stroke="#b08d30" strokeWidth=".8"/>
      <text x="42" y="10" textAnchor="middle" fill="white" fontSize="6" fontWeight="800" fontFamily="sans-serif">3</text>
    </svg>
  );
}

// Numbered icon badge — icon with number overlay
export function RackBadge({ number, size = 40, color = '#6366f1' }) {
  return (
    <div style={{ width: size, height: size, position: 'relative', flexShrink: 0 }}>
      <RackIcon size={size} />
      <div style={{
        position: 'absolute', bottom: -2, right: -2,
        width: size * 0.45, height: size * 0.45, borderRadius: '50%',
        background: color, display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: size * 0.25, fontWeight: 800, color: 'white', lineHeight: 1,
        border: '2px solid white',
      }}>{number}</div>
    </div>
  );
}

export function RowBadge({ number, size = 40, color = '#0891b2' }) {
  return (
    <div style={{ width: size, height: size, position: 'relative', flexShrink: 0 }}>
      <RowIcon size={size} />
      <div style={{
        position: 'absolute', bottom: -2, right: -2,
        width: size * 0.45, height: size * 0.45, borderRadius: '50%',
        background: color, display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: size * 0.25, fontWeight: 800, color: 'white', lineHeight: 1,
        border: '2px solid white',
      }}>{number}</div>
    </div>
  );
}

export function ShelfBadge({ number, size = 40, color = '#059669' }) {
  return (
    <div style={{ width: size, height: size, position: 'relative', flexShrink: 0 }}>
      <ShelfIcon size={size} />
      <div style={{
        position: 'absolute', bottom: -2, right: -2,
        width: size * 0.45, height: size * 0.45, borderRadius: '50%',
        background: color, display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: size * 0.25, fontWeight: 800, color: 'white', lineHeight: 1,
        border: '2px solid white',
      }}>{number}</div>
    </div>
  );
}

export function PalletBadge({ number, size = 40, color = '#d97706' }) {
  return (
    <div style={{ width: size, height: size, position: 'relative', flexShrink: 0 }}>
      <PalletIcon size={size} />
      <div style={{
        position: 'absolute', bottom: -2, right: -2,
        width: size * 0.45, height: size * 0.45, borderRadius: '50%',
        background: color, display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: size * 0.25, fontWeight: 800, color: 'white', lineHeight: 1,
        border: '2px solid white',
      }}>{number}</div>
    </div>
  );
}

// ─── Task type icons ─────────────────────────────────────────────────────────

export function InventoryIcon({ size = 20, className = '', style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={className} style={style}>
      {/* Clipboard board */}
      <rect x="8" y="6" width="32" height="38" rx="3" fill="#e8edf2" stroke="#8494a7" strokeWidth="1.3"/>
      {/* Clipboard clip */}
      <rect x="16" y="3" width="16" height="7" rx="2" fill="#5c6f82" stroke="#46586b" strokeWidth="1"/>
      <rect x="20" y="4.5" width="8" height="3" rx="1" fill="#8494a7"/>
      {/* Checkline 1 — checked */}
      <rect x="14" y="16" width="20" height="2.5" rx="1" fill="#b0bec5" opacity=".5"/>
      <circle cx="14" cy="17.2" r="3" fill="#4caf50" stroke="#388e3c" strokeWidth=".7"/>
      <path d="M12.5 17.2l1.2 1.2 2.2-2.4" stroke="white" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
      {/* Checkline 2 — checked */}
      <rect x="14" y="24" width="20" height="2.5" rx="1" fill="#b0bec5" opacity=".5"/>
      <circle cx="14" cy="25.2" r="3" fill="#4caf50" stroke="#388e3c" strokeWidth=".7"/>
      <path d="M12.5 25.2l1.2 1.2 2.2-2.4" stroke="white" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
      {/* Checkline 3 — unchecked */}
      <rect x="14" y="32" width="20" height="2.5" rx="1" fill="#b0bec5" opacity=".5"/>
      <circle cx="14" cy="33.2" r="3" fill="white" stroke="#b0bec5" strokeWidth="1"/>
      {/* Magnifier */}
      <circle cx="35" cy="36" r="6" fill="white" stroke="#5c6f82" strokeWidth="1.5"/>
      <circle cx="35" cy="36" r="3" fill="none" stroke="#5c6f82" strokeWidth="1"/>
      <line x1="39.5" y1="40.5" x2="43" y2="44" stroke="#5c6f82" strokeWidth="2" strokeLinecap="round"/>
    </svg>
  );
}

export function PackagingIcon({ size = 20, className = '', style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={className} style={style}>
      {/* Open box — back panel */}
      <path d="M6 20L24 12l18 8v18L24 46 6 38V20z" fill="#d4a76a" stroke="#b8884a" strokeWidth="1.3" strokeLinejoin="round"/>
      {/* Top face */}
      <path d="M6 20l18 8 18-8" fill="#e8c888" stroke="#b8884a" strokeWidth="1" strokeLinejoin="round"/>
      {/* Right face (darker) */}
      <path d="M24 28l18-8v18L24 46z" fill="#c49558"/>
      {/* Center line */}
      <path d="M24 28v18" stroke="#b8884a" strokeWidth="1"/>
      {/* Left flap (open) */}
      <path d="M6 20l9-7 9 5" fill="#e8d8a0" stroke="#b8884a" strokeWidth="1" strokeLinejoin="round" opacity=".85"/>
      {/* Right flap (open) */}
      <path d="M42 20l-9-7-9 5" fill="#dfc87a" stroke="#b8884a" strokeWidth="1" strokeLinejoin="round" opacity=".85"/>
      {/* Arrow down into box */}
      <path d="M24 2v12" stroke="#6366f1" strokeWidth="2.5" strokeLinecap="round"/>
      <path d="M20 10l4 5 4-5" stroke="#6366f1" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
      {/* Product jar silhouette inside */}
      <rect x="19" y="30" width="10" height="12" rx="2.5" fill="#f8f8f6" stroke="#d4d0c8" strokeWidth=".8" opacity=".7"/>
      <rect x="20" y="29" width="8" height="3" rx="1.5" fill="#c9a94e" opacity=".6"/>
    </svg>
  );
}

export function TransferIcon({ size = 20, className = '', style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={className} style={style}>
      {/* Factory/production building */}
      <rect x="2" y="20" width="16" height="18" rx="1.5" fill="#9bafc4" stroke="#6b7f96" strokeWidth="1.2"/>
      <rect x="5" y="14" width="4" height="6" rx=".5" fill="#7b8fa8" stroke="#5c6f82" strokeWidth=".8"/>
      <rect x="11" y="16" width="4" height="4" rx=".5" fill="#7b8fa8" stroke="#5c6f82" strokeWidth=".8"/>
      {/* Factory chimney smoke */}
      <path d="M7 14c0-2 1-3 1-4" stroke="#b0bec5" strokeWidth="1" strokeLinecap="round" opacity=".5"/>
      <path d="M13 16c0-1.5 .8-2.5 .8-3.5" stroke="#b0bec5" strokeWidth="1" strokeLinecap="round" opacity=".5"/>
      {/* Factory window */}
      <rect x="5" y="24" width="4" height="4" rx=".5" fill="#a3c4e8" stroke="#7b9ab8" strokeWidth=".5"/>
      <rect x="11" y="24" width="4" height="4" rx=".5" fill="#a3c4e8" stroke="#7b9ab8" strokeWidth=".5"/>
      {/* Factory door */}
      <rect x="7" y="31" width="6" height="7" rx="1" fill="#5a7089" stroke="#46586b" strokeWidth=".6"/>
      {/* Arrow pointing right */}
      <path d="M20 29h10" stroke="#6366f1" strokeWidth="2.5" strokeLinecap="round"/>
      <path d="M27 25l4 4-4 4" stroke="#6366f1" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
      {/* Pallet destination */}
      <rect x="32" y="24" width="14" height="3" rx=".8" fill="#d4b05a" stroke="#a88520" strokeWidth=".8"/>
      <rect x="34" y="27" width="3.5" height="6" rx=".5" fill="#a07820" stroke="#8a7020" strokeWidth=".5"/>
      <rect x="40.5" y="27" width="3.5" height="6" rx=".5" fill="#a07820" stroke="#8a7020" strokeWidth=".5"/>
      <rect x="32" y="33" width="14" height="3" rx=".8" fill="#d4b05a" stroke="#a88520" strokeWidth=".8"/>
      {/* Boxes on pallet */}
      <rect x="34" y="16" width="5" height="8" rx="1" fill="#d4a76a" stroke="#b8884a" strokeWidth=".7"/>
      <rect x="40" y="18" width="4" height="6" rx="1" fill="#c49558" stroke="#a87a3e" strokeWidth=".7"/>
    </svg>
  );
}

export function ReturnsIcon({ size = 20, className = '', style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={className} style={style}>
      {/* Closed box */}
      <path d="M6 22l18-8 18 8v16L24 46 6 38V22z" fill="#d4a76a" stroke="#b8884a" strokeWidth="1.3" strokeLinejoin="round"/>
      <path d="M6 22l18 8 18-8" fill="#e8c888" stroke="#b8884a" strokeWidth="1" strokeLinejoin="round"/>
      <path d="M24 30l18-8v16L24 46z" fill="#c49558"/>
      <path d="M24 30v16" stroke="#b8884a" strokeWidth="1"/>
      {/* Curved return arrow */}
      <path d="M34 6a12 12 0 01-20 0" stroke="#14b8a6" strokeWidth="2.8" strokeLinecap="round" fill="none"/>
      <path d="M18 2l-4 4 4 4" stroke="#14b8a6" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

// ─── Move Page Icons ─────────────────────────────────────────────────────────

// PieceScanIcon — hand scanner scanning a jar
export function PieceScanIcon({ size = 32, className = '' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={className}>
      {/* Scanner body */}
      <rect x="6" y="18" width="14" height="22" rx="3" fill="#3b82f6" stroke="#2563eb" strokeWidth="1.2"/>
      <rect x="8" y="20" width="10" height="6" rx="1.5" fill="#93c5fd"/>
      {/* Scanner beam */}
      <line x1="13" y1="28" x2="13" y2="38" stroke="#60a5fa" strokeWidth="1" strokeDasharray="2 1.5"/>
      {/* Laser line */}
      <line x1="20" y1="30" x2="38" y2="30" stroke="#ef4444" strokeWidth="1.5" opacity=".7"/>
      {/* Jar */}
      <rect x="28" y="14" width="14" height="24" rx="3.5" fill="#f8f8f6" stroke="#d4d0c8" strokeWidth="1"/>
      <rect x="30" y="12" width="10" height="4" rx="2" fill="#c9a94e" stroke="#b08d30" strokeWidth=".7"/>
      <rect x="30" y="35" width="10" height="3" rx="1.5" fill="#c9a94e"/>
      <rect x="30" y="20" width="10" height="10" rx="1" fill="white" stroke="#e8e0c8" strokeWidth=".5"/>
      <rect x="30" y="20" width="10" height="2.5" rx=".6" fill="#c9a94e" opacity=".7"/>
    </svg>
  );
}

// PourBoxIcon — box pouring into another box
export function PourBoxIcon({ size = 32, className = '' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={className}>
      {/* Source box tilted */}
      <g transform="rotate(-20 16 20)">
        <path d="M4 18l12-5 12 5v12L16 35 4 30V18z" fill="#a855f7" stroke="#7e22ce" strokeWidth="1" strokeLinejoin="round"/>
        <path d="M4 18l12 5 12-5" fill="#c084fc" stroke="#7e22ce" strokeWidth=".8"/>
      </g>
      {/* Pour arrow */}
      <path d="M24 22c4 2 6 6 6 10" stroke="#a855f7" strokeWidth="2" strokeLinecap="round" fill="none" strokeDasharray="3 2"/>
      <path d="M28 30l2 3-4 0" fill="#a855f7"/>
      {/* Target box */}
      <path d="M26 34l10-4 10 4v8L36 46 26 42V34z" fill="#d4a76a" stroke="#b8884a" strokeWidth="1" strokeLinejoin="round"/>
      <path d="M26 34l10 4 10-4" fill="#e8c888" stroke="#b8884a" strokeWidth=".8"/>
    </svg>
  );
}

// MoveBoxIcon — box with directional arrows
export function MoveBoxIcon({ size = 32, className = '' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={className}>
      {/* Box */}
      <path d="M10 20l14-6 14 6v14L24 40 10 34V20z" fill="#d4a76a" stroke="#b8884a" strokeWidth="1.2" strokeLinejoin="round"/>
      <path d="M10 20l14 6 14-6" fill="#e8c888" stroke="#b8884a" strokeWidth=".8"/>
      <path d="M24 26v14" stroke="#b8884a" strokeWidth=".8"/>
      {/* Arrow left */}
      <path d="M6 28H2l3-3M2 28l3 3" stroke="#f59e0b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      {/* Arrow right */}
      <path d="M42 28h4l-3-3M46 28l-3 3" stroke="#f59e0b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      {/* Pallet lines at bottom */}
      <rect x="8" y="42" width="32" height="3" rx=".8" fill="#d4b05a" stroke="#a88520" strokeWidth=".6"/>
    </svg>
  );
}

// AdminClipboardIcon — clipboard with checkmark (admin transfer)
export function AdminClipboardIcon({ size = 32, className = '' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={className}>
      {/* Clipboard */}
      <rect x="8" y="6" width="32" height="38" rx="3" fill="#fecaca" stroke="#ef4444" strokeWidth="1.2"/>
      <rect x="16" y="3" width="16" height="7" rx="2" fill="#dc2626" stroke="#b91c1c" strokeWidth=".8"/>
      <rect x="20" y="4.5" width="8" height="3" rx="1" fill="#fca5a5"/>
      {/* Lines */}
      <rect x="14" y="18" width="20" height="2" rx="1" fill="#fca5a5"/>
      <rect x="14" y="24" width="16" height="2" rx="1" fill="#fca5a5"/>
      <rect x="14" y="30" width="12" height="2" rx="1" fill="#fca5a5"/>
      {/* Checkmark circle */}
      <circle cx="34" cy="36" r="7" fill="#22c55e" stroke="#16a34a" strokeWidth="1"/>
      <path d="M30.5 36l2.5 2.5 4.5-5" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

// ─── Role-based Staff Avatars ────────────────────────────────────────────────

// Admin — person with shield badge
export function AdminAvatar({ size = 32, className = '' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={className}>
      <circle cx="24" cy="14" r="8" fill="#e0e7ff" stroke="#6366f1" strokeWidth="1.5"/>
      <circle cx="24" cy="14" r="4.5" fill="#818cf8"/>
      <path d="M8 42c0-8.8 7.2-16 16-16s16 7.2 16 16" fill="#6366f1" stroke="#4f46e5" strokeWidth="1.5"/>
      <path d="M8 42c0-8.8 7.2-16 16-16s16 7.2 16 16" fill="#818cf8"/>
      <rect x="17" y="30" width="14" height="10" rx="2" fill="#4f46e5"/>
      {/* Shield */}
      <path d="M24 32l-4 2v4c0 2 4 3.5 4 3.5s4-1.5 4-3.5v-4l-4-2z" fill="#fbbf24" stroke="#d97706" strokeWidth=".8"/>
      <path d="M22.5 37l1.5 1.5 3-3" stroke="#d97706" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

// Manager — person with tie
export function ManagerAvatar({ size = 32, className = '' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={className}>
      <circle cx="24" cy="14" r="8" fill="#dbeafe" stroke="#3b82f6" strokeWidth="1.5"/>
      <circle cx="24" cy="14" r="4.5" fill="#60a5fa"/>
      <path d="M8 42c0-8.8 7.2-16 16-16s16 7.2 16 16" fill="#3b82f6"/>
      {/* Shirt collar */}
      <path d="M18 28l6 4 6-4" fill="#1d4ed8" stroke="#1e40af" strokeWidth=".8"/>
      {/* Tie */}
      <path d="M24 32l-2 2 2 6 2-6-2-2z" fill="#ef4444" stroke="#dc2626" strokeWidth=".6"/>
    </svg>
  );
}

// Worker — person with hard hat (каска)
export function WorkerAvatar({ size = 32, className = '' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={className}>
      <circle cx="24" cy="16" r="7" fill="#fef3c7" stroke="#f59e0b" strokeWidth="1.5"/>
      <circle cx="24" cy="16" r="4" fill="#fbbf24"/>
      {/* Hard hat */}
      <path d="M15 13c0-5 4-8 9-8s9 3 9 8" fill="#f59e0b" stroke="#d97706" strokeWidth="1.2"/>
      <rect x="14" y="12" width="20" height="3" rx="1" fill="#fbbf24" stroke="#d97706" strokeWidth=".8"/>
      <path d="M8 42c0-8.8 7.2-16 16-16s16 7.2 16 16" fill="#f59e0b"/>
      {/* Vest lines */}
      <path d="M20 28v12M28 28v12" stroke="#d97706" strokeWidth="1" opacity=".4"/>
      <rect x="18" y="30" width="12" height="3" rx="1" fill="#fbbf24" opacity=".5"/>
    </svg>
  );
}

// Packer — person with apron (фартук)
export function PackerAvatar({ size = 32, className = '' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={className}>
      <circle cx="24" cy="14" r="8" fill="#d1fae5" stroke="#10b981" strokeWidth="1.5"/>
      <circle cx="24" cy="14" r="4.5" fill="#34d399"/>
      <path d="M8 42c0-8.8 7.2-16 16-16s16 7.2 16 16" fill="#10b981"/>
      {/* Apron */}
      <path d="M17 30h14v10c0 1-1 2-2 2H19c-1 0-2-1-2-2V30z" fill="#6ee7b7" stroke="#059669" strokeWidth=".8"/>
      <path d="M20 28v-1.5c0-.5.5-1 1-1h6c.5 0 1 .5 1 1V28" stroke="#059669" strokeWidth=".8"/>
      <rect x="22" y="32" width="4" height="4" rx=".8" fill="#059669" opacity=".3"/>
    </svg>
  );
}

// Controller/QC — person with magnifier
export function ControllerAvatar({ size = 32, className = '' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={className}>
      <circle cx="24" cy="14" r="8" fill="#fef9c3" stroke="#eab308" strokeWidth="1.5"/>
      <circle cx="24" cy="14" r="4.5" fill="#facc15"/>
      <path d="M8 42c0-8.8 7.2-16 16-16s16 7.2 16 16" fill="#eab308"/>
      {/* Lab coat */}
      <rect x="16" y="28" width="16" height="12" rx="2" fill="white" stroke="#d4d4d8" strokeWidth=".8"/>
      <line x1="24" y1="28" x2="24" y2="40" stroke="#d4d4d8" strokeWidth=".6"/>
      {/* Magnifier */}
      <circle cx="34" cy="35" r="4" fill="white" stroke="#eab308" strokeWidth="1.5"/>
      <line x1="37" y1="38" x2="40" y2="41" stroke="#eab308" strokeWidth="2" strokeLinecap="round"/>
    </svg>
  );
}

// Warehouse worker — person with boxes
export function WarehouseWorkerAvatar({ size = 32, className = '' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={className}>
      <circle cx="24" cy="14" r="8" fill="#ffedd5" stroke="#f97316" strokeWidth="1.5"/>
      <circle cx="24" cy="14" r="4.5" fill="#fb923c"/>
      <path d="M8 42c0-8.8 7.2-16 16-16s16 7.2 16 16" fill="#f97316"/>
      {/* Vest */}
      <path d="M18 28l6 3 6-3v12H18V28z" fill="#ea580c" opacity=".4"/>
      <rect x="20" y="33" width="8" height="5" rx="1" fill="#fdba74" stroke="#ea580c" strokeWidth=".6"/>
    </svg>
  );
}

// Default — generic person
export function DefaultAvatar({ size = 32, className = '' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={className}>
      <circle cx="24" cy="14" r="8" fill="#f3f4f6" stroke="#9ca3af" strokeWidth="1.5"/>
      <circle cx="24" cy="14" r="4.5" fill="#d1d5db"/>
      <path d="M8 42c0-8.8 7.2-16 16-16s16 7.2 16 16" fill="#9ca3af"/>
    </svg>
  );
}

// ─── Raw Materials & Tech Card icons ─────────────────────────────────────────

export function IngredientIcon({ size = 20, className = '', style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={className} style={style}>
      <path d="M18 4h12v14l10 22a3 3 0 01-2.7 4.3H10.7A3 3 0 018 40L18 18V4z" fill="#d0f0d8" stroke="#4a9a5e" strokeWidth="1.3" strokeLinejoin="round"/>
      <rect x="18" y="3" width="12" height="5" rx="1.5" fill="#e8f5ec" stroke="#4a9a5e" strokeWidth="1"/>
      <path d="M12 30l6-6h12l6 6v10a3 3 0 01-3 3H15a3 3 0 01-3-3V30z" fill="#6bc480" opacity=".6"/>
      <circle cx="20" cy="34" r="1.5" fill="#a8e0b8" opacity=".8"/>
      <circle cx="28" cy="32" r="1" fill="#a8e0b8" opacity=".6"/>
    </svg>
  );
}

export function PackagingMaterialIcon({ size = 20, className = '', style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={className} style={style}>
      <rect x="8" y="10" width="32" height="28" rx="3" fill="#e0e8f0" stroke="#7090b0" strokeWidth="1.3"/>
      <ellipse cx="24" cy="10" rx="16" ry="4" fill="#c0d0e0" stroke="#7090b0" strokeWidth="1"/>
      <ellipse cx="24" cy="38" rx="16" ry="4" fill="#b0c0d0" stroke="#7090b0" strokeWidth="1"/>
      <rect x="8" y="18" width="32" height="12" fill="#7090b0" opacity=".2"/>
      <line x1="14" y1="22" x2="34" y2="22" stroke="#7090b0" strokeWidth=".8" opacity=".5"/>
      <line x1="14" y1="26" x2="28" y2="26" stroke="#7090b0" strokeWidth=".8" opacity=".4"/>
    </svg>
  );
}

export function TechCardIcon({ size = 20, className = '', style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={className} style={style}>
      <rect x="6" y="3" width="30" height="42" rx="3" fill="#f0eef8" stroke="#7c6ab8" strokeWidth="1.3"/>
      <path d="M26 3h7a3 3 0 013 3v4H26V3z" fill="#c4b8e0" stroke="#7c6ab8" strokeWidth="1"/>
      <rect x="10" y="12" width="22" height="4" rx="1" fill="#7c6ab8" opacity=".7"/>
      <circle cx="13" cy="22" r="1.5" fill="#a890d0"/>
      <rect x="17" y="21" width="13" height="2" rx=".5" fill="#c4b8e0"/>
      <circle cx="13" cy="28" r="1.5" fill="#a890d0"/>
      <rect x="17" y="27" width="10" height="2" rx=".5" fill="#c4b8e0"/>
      <circle cx="13" cy="34" r="1.5" fill="#a890d0"/>
      <rect x="17" y="33" width="14" height="2" rx=".5" fill="#c4b8e0"/>
    </svg>
  );
}

export function RawMaterialsIcon({ size = 20, className = '', style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={className} style={style}>
      <path d="M6 22c0 10 8 18 18 18s18-8 18-18H6z" fill="#e8dcc7" stroke="#a88520" strokeWidth="1.3"/>
      <ellipse cx="24" cy="22" rx="18" ry="5" fill="#f0e8d0" stroke="#a88520" strokeWidth="1"/>
      <ellipse cx="24" cy="28" rx="12" ry="3" fill="#d4b870" opacity=".5"/>
      <line x1="34" y1="8" x2="26" y2="20" stroke="#8a7a60" strokeWidth="3" strokeLinecap="round"/>
      <circle cx="35" cy="7" r="3" fill="#a89070" stroke="#8a7a60" strokeWidth="1"/>
    </svg>
  );
}

// ─── Material group icons ────────────────────────────────────────────────────

export function MixIcon({ size = 20, className = '', style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={className} style={style}>
      {/* Bowl */}
      <path d="M6 20c0 12 8 20 18 20s18-8 18-20H6z" fill="#f5e6d0" stroke="#c07830" strokeWidth="1.3"/>
      <ellipse cx="24" cy="20" rx="18" ry="5" fill="#fae8d0" stroke="#c07830" strokeWidth="1"/>
      {/* Swirl pattern inside */}
      <path d="M14 26c3-2 6 2 10 0s7-2 10 0" stroke="#d89050" strokeWidth="1.5" strokeLinecap="round" fill="none" opacity=".5"/>
      <path d="M16 30c2-1.5 5 1.5 8 0s5-1.5 8 0" stroke="#c07830" strokeWidth="1.2" strokeLinecap="round" fill="none" opacity=".4"/>
      {/* Mixing stick */}
      <line x1="32" y1="6" x2="22" y2="22" stroke="#8a6a40" strokeWidth="2.5" strokeLinecap="round"/>
      {/* Particles flying */}
      <circle cx="18" cy="14" r="1.2" fill="#d89050" opacity=".5"/>
      <circle cx="28" cy="12" r="1" fill="#c07830" opacity=".4"/>
      <circle cx="22" cy="10" r=".8" fill="#d89050" opacity=".45"/>
    </svg>
  );
}

export function PowderIcon({ size = 20, className = '', style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={className} style={style}>
      {/* Powder mound — warm brown/beige */}
      <ellipse cx="24" cy="38" rx="20" ry="6" fill="#e0d0b8" stroke="#8a7050" strokeWidth="1"/>
      <path d="M8 38c0 0 4-18 16-22s16 22 16 22" fill="#c4a878" opacity=".6"/>
      <path d="M12 38c0 0 3-14 12-18s12 18 12 18" fill="#b09060" opacity=".5"/>
      {/* Falling particles */}
      <circle cx="24" cy="10" r="1.5" fill="#b09060" opacity=".6"/>
      <circle cx="20" cy="14" r="1" fill="#c4a878" opacity=".5"/>
      <circle cx="28" cy="12" r=".8" fill="#b09060" opacity=".4"/>
      <circle cx="22" cy="8" r=".7" fill="#c4a878" opacity=".35"/>
      <circle cx="26" cy="6" r="1.2" fill="#b09060" opacity=".5"/>
      {/* Texture dots */}
      <circle cx="18" cy="32" r=".8" fill="#8a7050" opacity=".25"/>
      <circle cx="28" cy="30" r=".6" fill="#8a7050" opacity=".2"/>
    </svg>
  );
}

export function SemiProductIcon({ size = 20, className = '', style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={className} style={style}>
      {/* Capsule — bottom half (transparent/cream) */}
      <rect x="14" y="4" width="20" height="40" rx="10" fill="#f5f0e0" stroke="#a0a080" strokeWidth="1.3"/>
      {/* Top half (dark green) */}
      <rect x="14" y="4" width="20" height="20" rx="10" fill="#3a8a50" stroke="#2a6a38" strokeWidth="1.3"/>
      {/* Join line */}
      <line x1="14" y1="24" x2="34" y2="24" stroke="#a0a080" strokeWidth="1"/>
      {/* Shine on top */}
      <path d="M29 10v8" stroke="white" strokeWidth="1.5" opacity=".3" strokeLinecap="round"/>
      {/* Powder inside bottom */}
      <circle cx="22" cy="30" r="1" fill="#c8c0a0" opacity=".4"/>
      <circle cx="26" cy="33" r=".8" fill="#c8c0a0" opacity=".3"/>
    </svg>
  );
}

export function LabelIcon({ size = 20, className = '', style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={className} style={style}>
      {/* White label/sticker */}
      <rect x="6" y="8" width="36" height="32" rx="3" fill="#ffffff" stroke="#d0d0d0" strokeWidth="1.3"/>
      {/* Peeling corner */}
      <path d="M36 8h3a3 3 0 013 3v3L36 8z" fill="#f0f0f0" stroke="#d0d0d0" strokeWidth="1"/>
      {/* Brand stripe — deep purple/brand */}
      <rect x="10" y="13" width="28" height="5" rx="1" fill="#7c3aed" opacity=".8"/>
      <text x="24" y="17.5" textAnchor="middle" fill="white" fontSize="3.5" fontWeight="700" fontFamily="sans-serif">GRAFLab</text>
      {/* Text lines */}
      <rect x="10" y="22" width="20" height="2" rx=".5" fill="#888" opacity=".2"/>
      <rect x="10" y="26" width="16" height="1.5" rx=".5" fill="#888" opacity=".15"/>
      <rect x="10" y="30" width="22" height="1.5" rx=".5" fill="#888" opacity=".12"/>
      {/* Barcode */}
      <rect x="10" y="34" width="14" height="4" rx=".5" fill="#333" opacity=".1"/>
    </svg>
  );
}

export function SuppliesIcon({ size = 20, className = '', style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={className} style={style}>
      {/* Jar/bottle shape */}
      <rect x="14" y="12" width="20" height="30" rx="3" fill="#e0e8f0" stroke="#6080a0" strokeWidth="1.3"/>
      {/* Neck */}
      <rect x="18" y="6" width="12" height="8" rx="2" fill="#c0d0e0" stroke="#6080a0" strokeWidth="1"/>
      {/* Cap */}
      <rect x="16" y="4" width="16" height="4" rx="2" fill="#6080a0"/>
      {/* Lid ring */}
      <rect x="20" y="5" width="8" height="1.5" rx=".5" fill="#8aa0b8" opacity=".5"/>
      {/* Label area */}
      <rect x="16" y="20" width="16" height="14" rx="1.5" fill="white" stroke="#c0d0e0" strokeWidth=".7"/>
      <rect x="18" y="22" width="12" height="2" rx=".5" fill="#6080a0" opacity=".3"/>
      <rect x="18" y="26" width="8" height="1.5" rx=".5" fill="#6080a0" opacity=".2"/>
      {/* Shine */}
      <path d="M30 14v24" stroke="white" strokeWidth="1.5" opacity=".25" strokeLinecap="round"/>
    </svg>
  );
}

// ─── Earnings / GRACoin icons ────────────────────────────────────────────────

export function GRACoinIcon({ size = 20, className = '', style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={className} style={style}>
      <circle cx="24" cy="24" r="19" fill="#fef3c7" stroke="#d4a020" strokeWidth="1.5"/>
      <circle cx="24" cy="24" r="15" fill="#fbbf24" opacity=".3"/>
      <text x="24" y="30" textAnchor="middle" fill="#b8860b" fontSize="16" fontWeight="900" fontFamily="sans-serif">G</text>
    </svg>
  );
}

export function WalletIcon({ size = 20, className = '', style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={className} style={style}>
      <rect x="6" y="14" width="36" height="24" rx="4" fill="#ede9fe" stroke="#7c3aed" strokeWidth="1.3"/>
      <rect x="6" y="14" width="36" height="8" rx="4" fill="#7c3aed" opacity=".15"/>
      <circle cx="36" cy="28" r="3" fill="#7c3aed"/><circle cx="36" cy="28" r="1.5" fill="#ede9fe"/>
      <path d="M10 14V12a4 4 0 014-4h20a4 4 0 014 4v2" stroke="#7c3aed" strokeWidth="1" fill="none"/>
    </svg>
  );
}

export function ScannerIcon({ size = 20, className = '', style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={className} style={style}>
      <rect x="14" y="6" width="20" height="36" rx="3" fill="#e0e7ff" stroke="#6366f1" strokeWidth="1.2"/>
      <rect x="18" y="10" width="12" height="16" rx="1.5" fill="white" stroke="#6366f1" strokeWidth=".8"/>
      <line x1="20" y1="14" x2="28" y2="14" stroke="#ef4444" strokeWidth="1.5" opacity=".7"/>
      <circle cx="24" cy="35" r="3" fill="#6366f1" opacity=".3"/><circle cx="24" cy="35" r="1.5" fill="#6366f1"/>
    </svg>
  );
}

export function OrderPickIcon({ size = 20, className = '', style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={className} style={style}>
      <path d="M8 16l16-10 16 10v20l-16 8-16-8z" fill="#fce7f3" stroke="#db2777" strokeWidth="1.2"/>
      <path d="M8 16l16 8 16-8" stroke="#db2777" strokeWidth="1" fill="none"/>
      <line x1="24" y1="24" x2="24" y2="44" stroke="#db2777" strokeWidth="1"/>
    </svg>
  );
}

export function TrendUpIcon({ size = 20, className = '', style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={className} style={style}>
      <path d="M6 38L18 22l8 8L42 10" stroke="#16a34a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M32 10h10v10" stroke="#16a34a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

export function AdjustIcon({ size = 20, className = '', style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={className} style={style}>
      <rect x="8" y="10" width="32" height="28" rx="3" fill="#fff7ed" stroke="#ea580c" strokeWidth="1.2"/>
      <line x1="14" y1="18" x2="34" y2="18" stroke="#ea580c" strokeWidth="1" opacity=".3"/>
      <line x1="14" y1="24" x2="28" y2="24" stroke="#ea580c" strokeWidth="1" opacity=".3"/>
      <line x1="14" y1="30" x2="24" y2="30" stroke="#ea580c" strokeWidth="1" opacity=".3"/>
      <text x="36" y="34" textAnchor="middle" fill="#ea580c" fontSize="14" fontWeight="900" fontFamily="sans-serif">+</text>
    </svg>
  );
}

export function RateGearIcon({ size = 20, className = '', style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={className} style={style}>
      <circle cx="24" cy="24" r="10" fill="#fef3c7" stroke="#d4a020" strokeWidth="1.2"/>
      <path d="M24 6v4M24 38v4M6 24h4M38 24h4M11 11l3 3M34 34l3 3M11 37l3-3M34 14l3-3" stroke="#d4a020" strokeWidth="1.5" strokeLinecap="round"/>
      <circle cx="24" cy="24" r="4" fill="none" stroke="#b8860b" strokeWidth="1"/>
    </svg>
  );
}

// ─── Individual supply/consumable icons ──────────────────────────────────────

export function JarLidIcon({ size = 20, className = '', style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={className} style={style}>
      {/* Lid — top view */}
      <ellipse cx="24" cy="24" rx="18" ry="8" fill="#5a8ab0" stroke="#3a6a90" strokeWidth="1.3"/>
      {/* Lid top surface */}
      <ellipse cx="24" cy="22" rx="18" ry="8" fill="#7aaad0" stroke="#5a8ab0" strokeWidth="1.2"/>
      {/* Grip ridges */}
      <ellipse cx="24" cy="22" rx="14" ry="5.5" fill="none" stroke="#5a8ab0" strokeWidth=".6" opacity=".4"/>
      <ellipse cx="24" cy="22" rx="10" ry="3.5" fill="none" stroke="#5a8ab0" strokeWidth=".5" opacity=".3"/>
      {/* Center dimple */}
      <ellipse cx="24" cy="21.5" rx="5" ry="2" fill="#5a8ab0" opacity=".25"/>
      {/* Shine */}
      <path d="M14 19c4-2 12-2 16 0" stroke="white" strokeWidth="1.2" opacity=".3" strokeLinecap="round" fill="none"/>
    </svg>
  );
}

export function PetJarIcon({ size = 20, className = '', style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={className} style={style}>
      {/* Jar body — transparent PET */}
      <rect x="10" y="14" width="28" height="28" rx="4" fill="#e8f4f8" stroke="#80b8d0" strokeWidth="1.3"/>
      {/* Jar neck */}
      <rect x="16" y="8" width="16" height="8" rx="2" fill="#d0ecf4" stroke="#80b8d0" strokeWidth="1"/>
      {/* Thread ridges */}
      <line x1="16" y1="10" x2="32" y2="10" stroke="#80b8d0" strokeWidth=".5" opacity=".5"/>
      <line x1="16" y1="12" x2="32" y2="12" stroke="#80b8d0" strokeWidth=".5" opacity=".4"/>
      {/* Bottom curve */}
      <path d="M12 40c0 1.5 2 2.5 5 2.5h14c3 0 5-1 5-2.5" stroke="#80b8d0" strokeWidth=".6" fill="none" opacity=".5"/>
      {/* Shine */}
      <path d="M33 16v22" stroke="white" strokeWidth="2" opacity=".35" strokeLinecap="round"/>
      <path d="M15 18v16" stroke="white" strokeWidth="1" opacity=".15" strokeLinecap="round"/>
    </svg>
  );
}

export function VacuumFlaskIcon({ size = 20, className = '', style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={className} style={style}>
      {/* Flask body — tall narrow */}
      <rect x="16" y="16" width="16" height="26" rx="8" fill="#f0e8f4" stroke="#9070b0" strokeWidth="1.3"/>
      {/* Neck */}
      <rect x="20" y="10" width="8" height="8" rx="1.5" fill="#e0d4ec" stroke="#9070b0" strokeWidth="1"/>
      {/* Pump dispenser top */}
      <rect x="18" y="4" width="12" height="3" rx="1.5" fill="#9070b0"/>
      {/* Pump nozzle */}
      <rect x="30" y="5" width="8" height="2" rx="1" fill="#a888c0"/>
      <circle cx="38" cy="6" r="1.5" fill="#9070b0"/>
      {/* Pump tube */}
      <line x1="24" y1="7" x2="24" y2="10" stroke="#9070b0" strokeWidth="1.2"/>
      {/* Fill level */}
      <rect x="17" y="28" width="14" height="13" rx="7" fill="#d4c0e8" opacity=".4"/>
      {/* Shine */}
      <path d="M28 18v18" stroke="white" strokeWidth="1.2" opacity=".3" strokeLinecap="round"/>
    </svg>
  );
}

export function MembraneIcon({ size = 20, className = '', style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={className} style={style}>
      {/* Aluminium foil circle — side angle */}
      <ellipse cx="24" cy="28" rx="18" ry="5" fill="#c8c0b0" stroke="#a09080" strokeWidth="1"/>
      <ellipse cx="24" cy="26" rx="18" ry="5" fill="#e8e0d0" stroke="#b0a090" strokeWidth="1.2"/>
      {/* Foil texture — concentric rings */}
      <ellipse cx="24" cy="26" rx="14" ry="3.8" fill="none" stroke="#c0b8a0" strokeWidth=".5"/>
      <ellipse cx="24" cy="26" rx="9" ry="2.4" fill="none" stroke="#c0b8a0" strokeWidth=".4"/>
      {/* Pull tab — red/orange */}
      <path d="M34 24l8-8" stroke="#c06040" strokeWidth="2" strokeLinecap="round"/>
      <circle cx="42" cy="16" r="3" fill="#d07050" stroke="#a05030" strokeWidth=".8"/>
      <circle cx="42" cy="16" r="1.2" fill="none" stroke="#a05030" strokeWidth=".6"/>
      {/* Peeling edge */}
      <path d="M34 24c2-1 3-3 3-5" stroke="#b0a090" strokeWidth=".8" fill="none" strokeLinecap="round"/>
      {/* Shine */}
      <path d="M14 24.5c5-1.5 14-1.5 18 0" stroke="white" strokeWidth="1" opacity=".4" fill="none"/>
    </svg>
  );
}

export function CapsuleEmptyIcon({ size = 20, className = '', style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={className} style={style}>
      {/* Bottom half — transparent/cream */}
      <rect x="14" y="4" width="20" height="40" rx="10" fill="#f8f4e8" stroke="#c0b898" strokeWidth="1.2"/>
      {/* Top half — translucent clear */}
      <rect x="14" y="4" width="20" height="20" rx="10" fill="#f0ece0" stroke="#c8c0a8" strokeWidth="1.2"/>
      {/* Join line — separation visible */}
      <line x1="14" y1="24" x2="34" y2="24" stroke="#c0b898" strokeWidth="1.2"/>
      {/* Empty inside hint — dashed */}
      <ellipse cx="24" cy="24" rx="6" ry="12" fill="none" stroke="#d0c8b0" strokeWidth=".5" strokeDasharray="2 2" opacity=".4"/>
      {/* Shine on top */}
      <path d="M29 10v8" stroke="white" strokeWidth="1.5" opacity=".35" strokeLinecap="round"/>
      {/* Shine on bottom */}
      <path d="M29 28v8" stroke="white" strokeWidth="1" opacity=".2" strokeLinecap="round"/>
    </svg>
  );
}

// ─── Sidebar navigation icons ────────────────────────────────────────────────

export function NavDashboardIcon({ size = 20, className = '', style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={className} style={style}>
      <rect x="4" y="4" width="18" height="18" rx="3" fill="#7c3aed" opacity=".75"/>
      <rect x="26" y="4" width="18" height="10" rx="3" fill="#a78bfa" opacity=".55"/>
      <rect x="4" y="26" width="18" height="10" rx="3" fill="#a78bfa" opacity=".55"/>
      <rect x="26" y="18" width="18" height="18" rx="3" fill="#7c3aed" opacity=".5"/>
      <rect x="4" y="40" width="40" height="4" rx="2" fill="#c4b5fd" opacity=".35"/>
    </svg>
  );
}

export function NavWarehouseIcon({ size = 20, className = '', style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={className} style={style}>
      <rect x="6" y="20" width="36" height="22" rx="2" fill="#c7d2e0" stroke="#8494a7" strokeWidth="1.2"/>
      <path d="M4 22L24 8l20 14" fill="#7b8fa8" stroke="#5c6f82" strokeWidth="1.2" strokeLinejoin="round"/>
      <rect x="18" y="29" width="12" height="13" rx="1.5" fill="#5a7089"/>
      <line x1="24" y1="29" x2="24" y2="42" stroke="#46586b" strokeWidth=".7"/>
    </svg>
  );
}

export function NavTasksIcon({ size = 20, className = '', style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={className} style={style}>
      <rect x="8" y="4" width="32" height="40" rx="3" fill="#e8edf2" stroke="#8494a7" strokeWidth="1.1"/>
      <rect x="16" y="2" width="16" height="5" rx="2" fill="#5c6f82"/>
      <circle cx="15" cy="18" r="2.5" fill="#4caf50"/>
      <path d="M13.5 18l1 1 2-2" stroke="white" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round"/>
      <rect x="20" y="16.5" width="14" height="2.5" rx="1" fill="#b0bec5" opacity=".45"/>
      <circle cx="15" cy="26" r="2.5" fill="#4caf50"/>
      <path d="M13.5 26l1 1 2-2" stroke="white" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round"/>
      <rect x="20" y="24.5" width="11" height="2.5" rx="1" fill="#b0bec5" opacity=".45"/>
      <circle cx="15" cy="34" r="2.5" fill="white" stroke="#b0bec5" strokeWidth=".9"/>
      <rect x="20" y="32.5" width="13" height="2.5" rx="1" fill="#b0bec5" opacity=".45"/>
    </svg>
  );
}

export function NavAnalyticsIcon({ size = 20, className = '', style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={className} style={style}>
      <rect x="6" y="30" width="8" height="14" rx="1.5" fill="#7c3aed" opacity=".6"/>
      <rect x="17" y="22" width="8" height="22" rx="1.5" fill="#7c3aed" opacity=".75"/>
      <rect x="28" y="12" width="8" height="32" rx="1.5" fill="#7c3aed" opacity=".9"/>
      <path d="M8 26l10-8 8 4 12-12" stroke="#a78bfa" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      <circle cx="38" cy="10" r="2.5" fill="#7c3aed"/>
    </svg>
  );
}

export function NavEarningsIcon({ size = 20, className = '', style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={className} style={style}>
      <circle cx="24" cy="24" r="17" fill="#fef3c7" stroke="#d97706" strokeWidth="1.4"/>
      <circle cx="24" cy="24" r="13" fill="#fbbf24" opacity=".25"/>
      <text x="24" y="29" textAnchor="middle" fill="#d97706" fontSize="15" fontWeight="800" fontFamily="sans-serif">G</text>
    </svg>
  );
}

export function NavMovementsIcon({ size = 20, className = '', style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={className} style={style}>
      <rect x="4" y="16" width="15" height="16" rx="2" fill="#c7d2e0" stroke="#8494a7" strokeWidth="1"/>
      <rect x="29" y="16" width="15" height="16" rx="2" fill="#c7e8d0" stroke="#6ba87b" strokeWidth="1"/>
      <path d="M21 21h6" stroke="#6366f1" strokeWidth="2.5" strokeLinecap="round"/>
      <path d="M25 18l3 3-3 3" stroke="#6366f1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M27 27h-6" stroke="#6366f1" strokeWidth="2.5" strokeLinecap="round"/>
      <path d="M23 30l-3-3 3-3" stroke="#6366f1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

export function NavErrorsIcon({ size = 20, className = '', style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={className} style={style}>
      <path d="M24 4L4 40h40L24 4z" fill="#fef3c7" stroke="#d97706" strokeWidth="1.4" strokeLinejoin="round"/>
      <line x1="24" y1="18" x2="24" y2="30" stroke="#d97706" strokeWidth="2.8" strokeLinecap="round"/>
      <circle cx="24" cy="35" r="2" fill="#d97706"/>
    </svg>
  );
}

export function NavStaffIcon({ size = 20, className = '', style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={className} style={style}>
      <circle cx="18" cy="14" r="6.5" fill="#fcd9b6" stroke="#e4a96a" strokeWidth="1.1"/>
      <path d="M14 11c0-4 2-6 4-6s4 2 4 6" fill="#5a3e28" opacity=".65"/>
      <path d="M18 24c-7 0-12 3-12 8v4h24v-4c0-5-5-8-12-8z" fill="#6366f1" opacity=".12" stroke="#6366f1" strokeWidth="1.1"/>
      <circle cx="34" cy="16" r="5" fill="#fcd9b6" stroke="#e4a96a" strokeWidth="1"/>
      <path d="M31 14c0-3 1.5-4.5 3-4.5s3 1.5 3 4.5" fill="#5a3e28" opacity=".65"/>
      <path d="M34 25c-4 0-8 2-8 6v3h16v-3c0-4-4-6-8-6z" fill="#6366f1" opacity=".08" stroke="#6366f1" strokeWidth=".9"/>
    </svg>
  );
}

export function NavSettingsIcon({ size = 20, className = '', style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={className} style={style}>
      <circle cx="24" cy="24" r="7.5" fill="none" stroke="#8494a7" strokeWidth="2.2"/>
      <circle cx="24" cy="24" r="3" fill="#8494a7"/>
      <circle cx="24" cy="6" r="3.2" fill="#8494a7"/>
      <circle cx="24" cy="42" r="3.2" fill="#8494a7"/>
      <circle cx="6" cy="24" r="3.2" fill="#8494a7"/>
      <circle cx="42" cy="24" r="3.2" fill="#8494a7"/>
      <circle cx="11.5" cy="11.5" r="2.8" fill="#8494a7"/>
      <circle cx="36.5" cy="11.5" r="2.8" fill="#8494a7"/>
      <circle cx="11.5" cy="36.5" r="2.8" fill="#8494a7"/>
      <circle cx="36.5" cy="36.5" r="2.8" fill="#8494a7"/>
    </svg>
  );
}

export function NavProductsIcon({ size = 20, className = '', style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={className} style={style}>
      <rect x="10" y="8" width="28" height="34" rx="4.5" fill="#f8f8f6" stroke="#d4d0c8" strokeWidth="1.2"/>
      <rect x="12" y="5" width="24" height="5.5" rx="2.5" fill="#c9a94e" stroke="#b08d30" strokeWidth=".9"/>
      <rect x="14" y="16" width="20" height="14" rx="1.2" fill="white" stroke="#e8e0c8" strokeWidth=".6"/>
      <rect x="14" y="16" width="20" height="3" rx=".8" fill="#c9a94e" opacity=".75"/>
      <rect x="16" y="22" width="14" height="1.5" rx=".4" fill="#b08d30" opacity=".25"/>
      <rect x="16" y="25" width="10" height="1.2" rx=".4" fill="#c9a94e" opacity=".18"/>
      <path d="M33 11v26" stroke="white" strokeWidth="1.3" opacity=".28" strokeLinecap="round"/>
    </svg>
  );
}

export function NavCardsIcon({ size = 20, className = '', style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={className} style={style}>
      <rect x="4" y="4" width="18" height="18" rx="3" fill="#f0eef8" stroke="#c4b8e0" strokeWidth=".9"/>
      <rect x="26" y="4" width="18" height="18" rx="3" fill="#f0eef8" stroke="#c4b8e0" strokeWidth=".9"/>
      <rect x="4" y="26" width="18" height="18" rx="3" fill="#f0eef8" stroke="#c4b8e0" strokeWidth=".9"/>
      <rect x="26" y="26" width="18" height="18" rx="3" fill="#f0eef8" stroke="#c4b8e0" strokeWidth=".9"/>
      <rect x="7" y="7" width="12" height="2" rx=".5" fill="#7c3aed" opacity=".45"/>
      <rect x="29" y="7" width="12" height="2" rx=".5" fill="#7c3aed" opacity=".45"/>
      <rect x="7" y="29" width="12" height="2" rx=".5" fill="#7c3aed" opacity=".45"/>
      <rect x="29" y="29" width="12" height="2" rx=".5" fill="#7c3aed" opacity=".45"/>
    </svg>
  );
}

export function NavStockIcon({ size = 20, className = '', style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={className} style={style}>
      <rect x="6" y="22" width="36" height="20" rx="3" fill="#e8edf2" stroke="#8494a7" strokeWidth="1.1"/>
      <rect x="10" y="14" width="28" height="10" rx="2" fill="#c7d2e0" stroke="#8494a7" strokeWidth=".9"/>
      <rect x="14" y="8" width="20" height="8" rx="2" fill="#9bafc4" stroke="#5c6f82" strokeWidth=".9"/>
      <circle cx="36" cy="16" r="5.5" fill="#4caf50" stroke="#388e3c" strokeWidth=".9"/>
      <path d="M33.5 16l2 2 3.5-3.5" stroke="white" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

// Aliases for backward compatibility
export const ShelfBoxIcon = BoxIcon;
