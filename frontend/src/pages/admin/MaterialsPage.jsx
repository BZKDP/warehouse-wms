import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Search, Package, X, ChevronRight, Save, Pencil } from 'lucide-react';
import { RawMaterialsIcon, IngredientIcon, PackagingMaterialIcon, TechCardIcon, PowderIcon, SemiProductIcon, LabelIcon, SuppliesIcon, MixIcon, JarLidIcon, PetJarIcon, VacuumFlaskIcon, MembraneIcon, CapsuleEmptyIcon, ProductIcon } from '../../components/ui/WarehouseIcons';
import api from '../../api/client';
import Spinner from '../../components/ui/Spinner';
import { usePerms } from '../../hooks/usePerms';

function fmtQty(val) {
  const n = parseFloat(val);
  if (isNaN(n)) return '0';
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, '');
}

function fmtPrice(val) {
  const n = parseFloat(val);
  if (isNaN(n) || n === 0) return '—';
  return n.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ₽';
}

const GROUP_LABELS = {
  'порошки': { label: 'Порошки', color: 'bg-green-100 text-green-700', Icon: PowderIcon },
  'полуфабрикаты': { label: 'Полуфабрикаты', color: 'bg-purple-100 text-purple-700', Icon: SemiProductIcon },
  'этикетки': { label: 'Этикетки', color: 'bg-amber-100 text-amber-700', Icon: LabelIcon },
  'смеси': { label: 'Смеси', color: 'bg-orange-100 text-orange-700', Icon: MixIcon },
  'расходники': { label: 'Расходники', color: 'bg-blue-100 text-blue-700', Icon: SuppliesIcon },
  'другое': { label: 'Другое', color: 'bg-gray-100 text-gray-600', Icon: PackagingMaterialIcon },
};

const SUPPLY_ICONS = {
  'мембран': MembraneIcon,
  'крышк':   JarLidIcon,
  'капсул':  CapsuleEmptyIcon,
  'флакон':  VacuumFlaskIcon,
  'дозатор': VacuumFlaskIcon,
  'банк':    PetJarIcon,
};

// Дата для input[type=date]: ISO/timestamp → YYYY-MM-DD (по локальному времени)
function toDateInput(v) {
  if (!v) return '';
  const d = new Date(v);
  if (isNaN(d)) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getSupplyIcon(name) {
  const lower = (name || '').toLowerCase();
  for (const [key, Icon] of Object.entries(SUPPLY_ICONS)) {
    if (lower.includes(key)) return Icon;
  }
  return SuppliesIcon;
}

function groupIcon(group, size = 18, materialName) {
  if (group === 'расходники') {
    const Icon = getSupplyIcon(materialName);
    return <Icon size={size} />;
  }
  const g = GROUP_LABELS[group] || GROUP_LABELS['другое'];
  const Icon = g.Icon;
  return <Icon size={size} />;
}

function groupBadge(group) {
  const g = GROUP_LABELS[group] || GROUP_LABELS['другое'];
  return <span className={`text-[11px] font-semibold px-2.5 py-1 rounded-full ${g.color}`}>{g.label}</span>;
}

/* ═══════════════════ Material Detail Modal ═══════════════════ */

function SectionBlock({ title, icon, children, className = '' }) {
  return (
    <div className={`rounded-2xl border border-gray-100 dark:border-gray-800 overflow-hidden ${className}`}>
      <div className="px-4 py-2.5 bg-gray-50 dark:bg-gray-800 border-b border-gray-100 dark:border-gray-700 flex items-center gap-2">
        {icon}
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{title}</p>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

const INPUT_CLS = 'w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-300 focus:border-primary-400 transition-all';

function MaterialDetailModal({ materialId, onClose, onUpdated }) {
  const navigate = useNavigate();
  const { can } = usePerms();
  const canEdit = can('products.edit');
  const [stack, setStack] = useState([]);
  const [currentId, setCurrentId] = useState(materialId);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  // Recipe add
  const [recipeSearch, setRecipeSearch] = useState('');
  const [recipeResults, setRecipeResults] = useState([]);
  const [recipeSearching, setRecipeSearching] = useState(false);
  const [recipeQty, setRecipeQty] = useState('');
  const [recipeSelected, setRecipeSelected] = useState(null);
  const [recipeAdding, setRecipeAdding] = useState(false);
  const recipeDebRef = useRef(null);

  useEffect(() => { setStack([]); setCurrentId(materialId); }, [materialId]);

  const navigateTo = (id) => { setStack(prev => [...prev, currentId]); setCurrentId(id); };
  const navigateBack = () => { setStack(prev => { const n = [...prev]; const p = n.pop(); setCurrentId(p); return n; }); };

  const load = useCallback(async () => {
    if (!currentId) return;
    setLoading(true);
    try {
      const r = await api.get(`/materials/${currentId}`);
      const d = r.data;
      setData(d);
      setForm({
        name: d.name || '', code: d.code || '', article: d.article || '',
        unit: d.unit || 'шт', category: d.category || 'ingredient',
        material_group: d.material_group || 'другое',
        buy_price: d.buy_price ? parseFloat(d.buy_price) : '',
        stock: d.stock ? parseFloat(d.stock) : '',
        min_stock: d.min_stock ? parseFloat(d.min_stock) : '',
        supplier: d.supplier || '', notes: d.notes || '',
        created_at: toDateInput(d.created_at),
      });
    } catch { setData(null); }
    setLoading(false);
  }, [currentId]);

  useEffect(() => { load(); }, [load]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const body = { ...form };
      if (body.buy_price === '') body.buy_price = null;
      if (body.stock === '') body.stock = 0;
      if (body.min_stock === '') body.min_stock = 0;
      if (!body.created_at) delete body.created_at;
      await api.put(`/materials/${currentId}`, body);
      await load();
      onUpdated?.();
    } catch {}
    setSaving(false);
  };

  // Recipe search
  const searchRecipe = (q) => {
    clearTimeout(recipeDebRef.current);
    setRecipeSearch(q);
    if (q.length < 2) { setRecipeResults([]); return; }
    recipeDebRef.current = setTimeout(async () => {
      setRecipeSearching(true);
      try {
        const res = await api.get('/materials', { params: { search: q, limit: 10 } });
        const existingIds = new Set((data?.recipe || []).map(r => r.id));
        existingIds.add(currentId);
        setRecipeResults((res.data.items || []).filter(m => !existingIds.has(m.id)));
      } catch { setRecipeResults([]); }
      setRecipeSearching(false);
    }, 300);
  };

  const addRecipeIngredient = async () => {
    if (!recipeSelected || !recipeQty) return;
    setRecipeAdding(true);
    try {
      await api.post(`/materials/${currentId}/recipe`, { ingredient_id: recipeSelected.id, quantity: parseFloat(recipeQty) });
      setRecipeSelected(null); setRecipeSearch(''); setRecipeResults([]); setRecipeQty('');
      await load();
      onUpdated?.();
    } catch {}
    setRecipeAdding(false);
  };

  const removeRecipeIngredient = async (recipeId) => {
    try {
      await api.delete(`/materials/${currentId}/recipe/${recipeId}`);
      await load();
      onUpdated?.();
    } catch {}
  };

  if (!materialId) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-100 dark:border-gray-800 w-full max-w-5xl max-h-[90vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-800 flex-shrink-0">
          <div className="flex items-center gap-3">
            {stack.length > 0 && (
              <button onClick={navigateBack} className="p-1.5 rounded-lg text-gray-400 hover:text-primary-600 hover:bg-primary-50 transition-all">
                <ChevronRight size={16} className="rotate-180" />
              </button>
            )}
            {!loading && data && (
              <>
                <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-gray-50 dark:bg-gray-800">
                  {groupIcon(data.material_group, 22, data.name)}
                </div>
                <div>
                  <h2 className="text-base font-bold text-gray-900 dark:text-white">{data.name}</h2>
                  <div className="flex items-center gap-2 mt-0.5">
                    {data.code && <span className="text-xs font-mono text-gray-400">{data.code}</span>}
                    {groupBadge(data.material_group)}
                    <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${data.category === 'ingredient' ? 'bg-green-50 text-green-600' : 'bg-blue-50 text-blue-600'}`}>
                      {data.category === 'ingredient' ? 'Ингредиент' : 'Упаковка'}
                    </span>
                  </div>
                </div>
              </>
            )}
            {loading && <span className="text-sm text-gray-400">Загрузка...</span>}
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {loading ? (
            <div className="flex items-center justify-center py-20"><Spinner /></div>
          ) : !data ? (
            <div className="text-center text-gray-400 py-20">Не найдено</div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

              {/* LEFT COLUMN */}
              <div className="space-y-4">

                {/* Основное */}
                <SectionBlock title="Основное" icon={<Package size={14} className="text-gray-400" />}>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="block col-span-2"><span className="text-[11px] text-gray-400 font-medium">Название</span>
                      <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className={INPUT_CLS} /></label>
                    <label className="block"><span className="text-[11px] text-gray-400 font-medium">Код</span>
                      <input value={form.code} onChange={e => setForm({ ...form, code: e.target.value })} className={INPUT_CLS} /></label>
                    <label className="block"><span className="text-[11px] text-gray-400 font-medium">Артикул</span>
                      <input value={form.article} onChange={e => setForm({ ...form, article: e.target.value })} className={INPUT_CLS} /></label>
                    <label className="block"><span className="text-[11px] text-gray-400 font-medium">Категория</span>
                      <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} className={INPUT_CLS}>
                        <option value="ingredient">Ингредиент</option>
                        <option value="packaging">Упаковка</option>
                      </select></label>
                    <label className="block"><span className="text-[11px] text-gray-400 font-medium">Группа</span>
                      <select value={form.material_group} onChange={e => setForm({ ...form, material_group: e.target.value })} className={INPUT_CLS}>
                        {Object.entries(GROUP_LABELS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                      </select></label>
                    <label className="block"><span className="text-[11px] text-gray-400 font-medium">Единица измерения</span>
                      <select value={form.unit} onChange={e => setForm({ ...form, unit: e.target.value })} className={INPUT_CLS}>
                        <option value="шт">шт</option><option value="г">г (грамм)</option>
                        <option value="мг">мг</option><option value="кг">кг</option>
                        <option value="мл">мл</option><option value="л">л</option>
                        <option value="уп">уп</option>
                      </select></label>
                    <label className="block"><span className="text-[11px] text-gray-400 font-medium">Поставщик</span>
                      <input value={form.supplier} onChange={e => setForm({ ...form, supplier: e.target.value })} className={INPUT_CLS} placeholder="Необязательно" /></label>
                    <label className="block"><span className="text-[11px] text-gray-400 font-medium">Дата создания</span>
                      <input type="date" value={form.created_at || ''} onChange={e => setForm({ ...form, created_at: e.target.value })} className={INPUT_CLS} /></label>
                  </div>
                </SectionBlock>

                {/* Остатки и цены */}
                <SectionBlock title="Остатки и цены" icon={<span className="text-gray-400 text-sm">₽</span>}>
                  <div className="grid grid-cols-3 gap-3">
                    <label className="block"><span className="text-[11px] text-gray-400 font-medium">Остаток ({form.unit || 'шт'})</span>
                      <input type="number" step="0.001" value={form.stock} onChange={e => setForm({ ...form, stock: e.target.value })} className={INPUT_CLS} /></label>
                    <label className="block"><span className="text-[11px] text-gray-400 font-medium">Мин. запас</span>
                      <input type="number" step="0.001" value={form.min_stock} onChange={e => setForm({ ...form, min_stock: e.target.value })} className={INPUT_CLS} /></label>
                    <label className="block"><span className="text-[11px] text-gray-400 font-medium">Цена закупки (₽)</span>
                      <input type="number" step="0.01" value={form.buy_price} onChange={e => setForm({ ...form, buy_price: e.target.value })} className={INPUT_CLS} /></label>
                  </div>
                </SectionBlock>

                {/* Примечания */}
                <SectionBlock title="Примечания" icon={<Pencil size={14} className="text-gray-400" />}>
                  <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={3} placeholder="Заметки по материалу..." className={`${INPUT_CLS} resize-none`} />
                </SectionBlock>
              </div>

              {/* RIGHT COLUMN */}
              <div className="space-y-4">

                {/* Рецепт */}
                <SectionBlock title={`Рецепт — состоит из (${data.recipe?.length || 0})`} icon={<span className="text-gray-400">🧪</span>}>
                  {/* Add ingredient */}
                  {canEdit && <div className="mb-3">
                    {!recipeSelected ? (
                      <div className="relative">
                        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-300" />
                        <input
                          value={recipeSearch}
                          onChange={e => searchRecipe(e.target.value)}
                          placeholder="Поиск материала для добавления..."
                          className={`${INPUT_CLS} pl-9`}
                        />
                        {recipeSearching && <div className="absolute right-3 top-1/2 -translate-y-1/2"><Spinner size="sm" /></div>}
                        {recipeResults.length > 0 && (
                          <div className="absolute z-10 left-0 right-0 mt-1 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-lg max-h-48 overflow-y-auto">
                            {recipeResults.map(m => (
                              <button key={m.id} onClick={() => { setRecipeSelected(m); setRecipeSearch(''); setRecipeResults([]); }}
                                className="w-full text-left px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center gap-2 transition-colors">
                                <span className="flex-shrink-0">{groupIcon(m.material_group, 14, m.name)}</span>
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">{m.name}</p>
                                  {m.code && <p className="text-[10px] text-gray-400">{m.code}</p>}
                                </div>
                                <span className="text-xs text-gray-400">{m.unit || 'шт'}</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <div className="flex items-center gap-2 flex-1 px-3 py-2 bg-primary-50 dark:bg-primary-900/20 rounded-xl">
                          <span>{groupIcon(recipeSelected.material_group, 14, recipeSelected.name)}</span>
                          <span className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate flex-1">{recipeSelected.name}</span>
                          <button onClick={() => setRecipeSelected(null)} className="text-gray-400 hover:text-gray-600"><X size={14} /></button>
                        </div>
                        <input type="number" step="0.001" min="0.001" value={recipeQty} onChange={e => setRecipeQty(e.target.value)}
                          placeholder="Кол-во" className={`${INPUT_CLS} w-24`} />
                        <button onClick={addRecipeIngredient} disabled={recipeAdding || !recipeQty}
                          className="px-3 py-2 bg-primary-600 text-white rounded-xl text-sm font-semibold hover:bg-primary-700 disabled:opacity-50 transition-colors whitespace-nowrap">
                          {recipeAdding ? '...' : '+ Добавить'}
                        </button>
                      </div>
                    )}
                  </div>}

                  {/* Recipe list */}
                  {(data.recipe?.length || 0) > 0 ? (
                    <div className="space-y-1.5">
                      {data.recipe.map((r, i) => (
                        <div key={r.recipe_id || i} className="flex items-center gap-3 px-3 py-2 rounded-xl bg-gray-50 dark:bg-gray-800 group hover:bg-purple-50/50 dark:hover:bg-purple-900/10 transition-colors cursor-pointer" onClick={() => r.id && navigateTo(r.id)}>
                          <span className="flex-shrink-0">{groupIcon(r.material_group, 16, r.name)}</span>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">{r.name}</p>
                            {r.code && <p className="text-[10px] text-gray-400">{r.code}</p>}
                          </div>
                          <span className="text-sm font-bold text-gray-700 dark:text-gray-300 flex-shrink-0">{fmtQty(r.quantity)} {r.unit || 'шт'}</span>
                          {canEdit && <button onClick={(e) => { e.stopPropagation(); removeRecipeIngredient(r.recipe_id); }}
                            className="p-1 rounded-lg text-gray-300 hover:text-rose-500 hover:bg-rose-50 opacity-0 group-hover:opacity-100 transition-all">
                            <X size={14} />
                          </button>}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-gray-300 text-center py-4">Рецепт пуст — добавьте ингредиенты через поиск выше</p>
                  )}
                </SectionBlock>

                {/* Используется в */}
                {data.used_in_materials?.length > 0 && (
                  <SectionBlock title={`Используется в (${data.used_in_materials.length})`} icon={<ChevronRight size={14} className="text-gray-400" />}>
                    <div className="space-y-1.5">
                      {data.used_in_materials.map((m, i) => (
                        <div key={m.id || i} className="flex items-center gap-3 px-3 py-2 rounded-xl bg-gray-50 dark:bg-gray-800 cursor-pointer hover:bg-purple-50/50 transition-colors" onClick={() => m.id && navigateTo(m.id)}>
                          <span className="flex-shrink-0">{groupIcon(m.material_group, 16, m.name)}</span>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-purple-700 dark:text-purple-400 truncate">{m.name}</p>
                          </div>
                          <span className="text-sm font-bold text-gray-700 dark:text-gray-300 flex-shrink-0">{fmtQty(m.quantity)} {data.unit || 'шт'}</span>
                          <ChevronRight size={14} className="text-gray-300" />
                        </div>
                      ))}
                    </div>
                  </SectionBlock>
                )}

                {/* Тех. карты */}
                {data.tech_cards?.length > 0 && (
                  <SectionBlock title={`Тех. карты (${data.tech_cards.length})`} icon={<TechCardIcon size={14} />}>
                    <div className="space-y-1.5">
                      {data.tech_cards.map((tc, i) => (
                        <div key={tc.id || i} className="flex items-center gap-3 px-3 py-2 rounded-xl bg-gray-50 dark:bg-gray-800 cursor-pointer hover:bg-purple-50/50 transition-colors"
                          onClick={() => { if (tc.product_id) { onClose(); navigate(`/admin/products/cards?id=${tc.product_id}`); } }}>
                          <span className="flex-shrink-0"><ProductIcon size={16} /></span>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-purple-700 dark:text-purple-400 truncate">{tc.product_name}</p>
                            <p className="text-[10px] text-gray-400">{tc.name}</p>
                          </div>
                          <span className="text-sm font-bold text-purple-600 flex-shrink-0">{fmtQty(tc.quantity)} {data.unit || 'шт'}</span>
                          <ChevronRight size={14} className="text-gray-300" />
                        </div>
                      ))}
                    </div>
                  </SectionBlock>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        {!loading && data && (
          <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-100 dark:border-gray-800 flex-shrink-0">
            <button onClick={onClose} className="px-4 py-2.5 text-sm text-gray-500 hover:text-gray-700 transition-colors rounded-xl hover:bg-gray-50">Отмена</button>
            {canEdit && <button onClick={handleSave} disabled={saving}
              className="flex items-center gap-1.5 px-5 py-2.5 bg-primary-600 text-white rounded-xl text-sm font-semibold hover:bg-primary-700 disabled:opacity-50 transition-colors shadow-sm">
              <Save size={14} />{saving ? 'Сохранение...' : 'Сохранить'}
            </button>}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

/* ═══════════════════ Main Page ═══════════════════ */

export default function MaterialsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedId = searchParams.get('id') ? parseInt(searchParams.get('id')) : null;
  const search = searchParams.get('search') || '';
  const group = searchParams.get('group') || '';

  const setSelectedId = (id) => {
    const p = new URLSearchParams(searchParams);
    if (id) p.set('id', id); else p.delete('id');
    setSearchParams(p);
  };
  const setSearch = (val) => {
    const p = new URLSearchParams(searchParams);
    if (val) p.set('search', val); else p.delete('search');
    setSearchParams(p);
  };
  const setGroup = (val) => {
    const p = new URLSearchParams(searchParams);
    if (val) p.set('group', val); else p.delete('group');
    setSearchParams(p);
  };

  const [archived, setArchived] = useState(false);
  const [page, setPage] = useState(1);
  const limit = 50;

  const [materials, setMaterials] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ total: 0, groups: [] });
  const [sortBy, setSortBy] = useState('stock');
  const [sortDir, setSortDir] = useState('desc');

  const [debouncedSearch, setDebouncedSearch] = useState('');
  const debounceRef = useRef(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { setDebouncedSearch(search); setPage(1); }, 400);
    return () => clearTimeout(debounceRef.current);
  }, [search]);

  const fetchMaterials = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, limit, sort_by: sortBy, sort_dir: sortDir };
      if (debouncedSearch) params.search = debouncedSearch;
      if (group) params.material_group = group;
      if (archived) params.archived = true;
      const res = await api.get('/materials', { params });
      setMaterials(res.data.rows || []);
      setTotal(res.data.total || 0);
    } catch { setMaterials([]); setTotal(0); }
    finally { setLoading(false); }
  }, [page, debouncedSearch, group, archived, sortBy, sortDir]);

  const handleSort = (col) => {
    if (sortBy === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortBy(col); setSortDir(col === 'stock' || col === 'buy_price' ? 'desc' : 'asc'); }
    setPage(1);
  };

  const sortArrow = (col) => sortBy === col ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ' ↕';

  const fetchStats = useCallback(async () => {
    try { const res = await api.get('/materials/stats'); setStats(res.data); } catch {}
  }, []);

  useEffect(() => { fetchMaterials(); }, [fetchMaterials]);
  useEffect(() => { fetchStats(); }, [fetchStats]);

  const totalPages = Math.ceil(total / limit) || 1;

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-3">
          <RawMaterialsIcon size={28} />
          Сырьё и упаковка
        </h1>
        {/* Group filter chips */}
        <div className="flex flex-wrap items-center gap-2 mt-3">
          <button
            onClick={() => { setGroup(''); setPage(1); }}
            className={`text-xs px-3 py-1.5 rounded-full transition-all ${!group ? 'glass-btn text-primary-700 bg-primary-600/10 border border-primary-600/25 backdrop-blur-xl shadow-[0_2px_10px_rgba(124,58,237,0.12)] font-semibold' : 'text-gray-500 bg-white/50 border border-gray-200 hover:bg-white/70 hover:text-gray-700 font-semibold'}`}
          >
            Все ({stats.total})
          </button>
          {(stats.groups || []).sort((a, b) => {
            const order = ['полуфабрикаты', 'расходники', 'этикетки', 'смеси', 'порошки', 'другое'];
            return (order.indexOf(a.group) === -1 ? 99 : order.indexOf(a.group)) - (order.indexOf(b.group) === -1 ? 99 : order.indexOf(b.group));
          }).map(g => {
            const gl = GROUP_LABELS[g.group] || GROUP_LABELS['другое'];
            return (
              <button
                key={g.group}
                onClick={() => { setGroup(g.group); setPage(1); }}
                className={`text-xs px-3 py-1.5 rounded-full transition-all ${group === g.group ? 'glass-btn text-primary-700 bg-primary-600/10 border border-primary-600/25 backdrop-blur-xl shadow-[0_2px_10px_rgba(124,58,237,0.12)] font-semibold' : 'text-gray-500 bg-white/50 border border-gray-200 hover:bg-white/70 hover:text-gray-700 font-semibold'}`}
              >
                {gl.label} ({g.count})
              </button>
            );
          })}
        </div>
      </div>

      {/* Search */}
      <div className="bg-white/60 backdrop-blur-sm rounded-xl border border-gray-200/60 p-4">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input placeholder="Поиск по названию или коду..." value={search} onChange={e => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 rounded-lg bg-white/50 border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-transparent" />
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer whitespace-nowrap">
            <input type="checkbox" checked={archived} onChange={e => { setArchived(e.target.checked); setPage(1); }} className="rounded border-gray-300 text-primary-600 focus:ring-primary-500" />
            Архивные
          </label>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-20"><Spinner /></div>
        ) : materials.length === 0 ? (
          <div className="text-center py-20">
            <Package size={40} className="mx-auto text-gray-300 mb-3" />
            <p className="text-gray-400 text-sm">Материалы не найдены</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  {[
                    { key: 'name', label: 'Название', align: 'left' },
                    { key: 'code', label: 'Код', align: 'left' },
                    { key: 'material_group', label: 'Группа', align: 'left' },
                    { key: 'buy_price', label: 'Закупка', align: 'right' },
                    { key: 'stock', label: 'Остаток', align: 'right' },
                  ].map(col => (
                    <th
                      key={col.label}
                      onClick={col.key ? () => handleSort(col.key) : undefined}
                      className={`${col.align === 'right' ? 'text-right' : 'text-left'} px-4 py-3 font-semibold text-xs uppercase tracking-wider whitespace-nowrap select-none ${
                        col.key ? 'cursor-pointer hover:text-purple-600 ' : ''
                      }${sortBy === col.key ? 'text-purple-600' : 'text-gray-500'}`}
                    >
                      {col.label}{col.key && <span className="text-[10px] opacity-50">{sortArrow(col.key)}</span>}
                    </th>
                  ))}
                  <th className="w-8"></th>
                </tr>
              </thead>
              <tbody>
                {materials.map(m => (
                  <tr key={m.id} onClick={() => setSelectedId(m.id)} className="border-b border-gray-50 hover:bg-purple-50/30 cursor-pointer transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {groupIcon(m.material_group, 18, m.name)}
                        <span className="font-medium text-gray-800">{m.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-500 font-mono text-xs">{m.code || '—'}</td>
                    <td className="px-4 py-3">{groupBadge(m.material_group)}</td>
                    <td className="px-4 py-3 text-right text-gray-600">{fmtPrice(m.buy_price)}</td>
                    <td className="px-4 py-3 text-right font-bold text-gray-900">{fmtQty(m.stock)} <span className="text-gray-400 font-normal text-xs">{m.unit || 'шт'}</span></td>
                    <td className="px-4 py-3"><ChevronRight size={14} className="text-gray-300" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
            <p className="text-xs text-gray-400">Страница {page} из {totalPages} · {total} записей</p>
            <div className="flex items-center gap-1">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1} className="px-3 py-1.5 text-xs rounded-lg border border-gray-200 disabled:opacity-40 hover:bg-gray-50 transition-colors">Назад</button>
              <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="px-3 py-1.5 text-xs rounded-lg border border-gray-200 disabled:opacity-40 hover:bg-gray-50 transition-colors">Вперёд</button>
            </div>
          </div>
        )}
      </div>

      <MaterialDetailModal materialId={selectedId} onClose={() => setSelectedId(null)} onUpdated={() => { fetchMaterials(); fetchStats(); }} />
    </div>
  );
}
