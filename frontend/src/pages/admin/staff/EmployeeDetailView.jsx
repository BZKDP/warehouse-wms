import { useState, useEffect, useCallback, useRef } from 'react';
import { Plus, Pencil, Trash2, Package, ChevronRight, Search, Check, X } from 'lucide-react';
import api from '../../../api/client';
import { qty } from '../../../utils/fmt';
import { getTypeMeta, fmtSource as movFmtSource } from '../../../utils/movementTypes';
import Button from '../../../components/ui/Button';
import Input from '../../../components/ui/Input';
import Badge from '../../../components/ui/Badge';
import Spinner from '../../../components/ui/Spinner';
import { useToast } from '../../../components/ui/Toast';

export default function EmployeeDetailView({ employee, onBack }) {
  const toast = useToast();
  const [inventory, setInventory] = useState([]);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editItem, setEditItem] = useState(null);
  const [editQty, setEditQty] = useState('');
  const [saving, setSaving] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [addSearch, setAddSearch] = useState('');
  const [addResults, setAddResults] = useState([]);
  const [addSelected, setAddSelected] = useState(null);
  const [addQty, setAddQty] = useState('1');
  const [addLoading, setAddLoading] = useState(false);
  const [addSaving, setAddSaving] = useState(false);
  const debRef = useRef(null);

  const loadData = useCallback(() => {
    setLoading(true);
    Promise.all([
      api.get(`/movements/employee-inventory/${employee.id}`).then(r => setInventory(r.data)).catch(() => {}),
      api.get(`/movements/history?employee_id=${employee.id}&limit=50`).then(r => setHistory(r.data.items || [])).catch(() => {}),
    ]).finally(() => setLoading(false));
  }, [employee.id]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleSaveQty = async () => {
    const newQty = parseFloat(editQty);
    if (isNaN(newQty) || newQty < 0) return;
    setSaving(true);
    try {
      if (newQty <= 0) {
        await api.delete(`/movements/employee-inventory/${employee.id}/${editItem.product_id}`);
        toast.success('Товар убран');
      } else {
        await api.put(`/movements/employee-inventory/${employee.id}/${editItem.product_id}`, { quantity: newQty });
        toast.success('Количество обновлено');
      }
      setEditItem(null);
      loadData();
    } catch (err) { toast.error(err.response?.data?.error || 'Ошибка'); }
    finally { setSaving(false); }
  };

  const handleDelete = async (item) => {
    if (!confirm(`Убрать «${item.product_name}» у сотрудника?`)) return;
    try {
      await api.delete(`/movements/employee-inventory/${employee.id}/${item.product_id}`);
      toast.success('Товар убран');
      loadData();
    } catch (err) { toast.error(err.response?.data?.error || 'Ошибка'); }
  };

  const searchProducts = (q) => {
    setAddSearch(q);
    clearTimeout(debRef.current);
    if (q.length < 2) { setAddResults([]); return; }
    debRef.current = setTimeout(async () => {
      setAddLoading(true);
      try {
        const res = await api.get('/products', { params: { search: q, limit: 10 } });
        setAddResults(res.data.items || []);
      } finally { setAddLoading(false); }
    }, 300);
  };

  const handleAddProduct = async () => {
    if (!addSelected || !addQty) return;
    setAddSaving(true);
    try {
      await api.post(`/movements/employee-inventory/${employee.id}`, { product_id: addSelected.id, quantity: parseFloat(addQty) });
      toast.success('Товар добавлен');
      setShowAdd(false); setAddSearch(''); setAddResults([]); setAddSelected(null); setAddQty('1');
      loadData();
    } catch (err) { toast.error(err.response?.data?.error || 'Ошибка'); }
    finally { setAddSaving(false); }
  };

  const fmtDateLocal = (iso) => iso ? new Date(iso).toLocaleString('ru-RU', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' }) : '—';

  return (
    <div>
      <div className="flex items-center gap-3 mb-5">
        <button onClick={onBack} className="p-2 rounded-xl text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-all">
          <ChevronRight size={18} style={{ transform: 'rotate(180deg)' }} />
        </button>
        <div className="flex-1">
          <h2 className="text-xl font-bold text-gray-900">{employee.full_name}</h2>
          <p className="text-sm text-gray-400">{employee.position || 'Сотрудник'}</p>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Spinner size="lg" /></div>
      ) : (
        <div className="space-y-6">
          {/* Inventory */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                Товар на руках {inventory.length > 0 && <span className="text-primary-500 ml-1">({inventory.length})</span>}
              </p>
              {!showAdd && (
                <button onClick={() => setShowAdd(true)}
                  className="flex items-center gap-1 text-xs text-primary-600 hover:text-primary-800 font-medium">
                  <Plus size={13} /> Добавить товар
                </button>
              )}
            </div>

            {showAdd && (
              <div className="card p-4 mb-3 bg-primary-50 border border-primary-100">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Добавить товар сотруднику</p>
                {!addSelected ? (
                  <div className="space-y-2">
                    <Input placeholder="Поиск товара..." value={addSearch} onChange={e => searchProducts(e.target.value)} icon={<Search size={15} />} />
                    {addLoading && <div className="text-center py-2"><Spinner size="sm" /></div>}
                    {addResults.length > 0 && (
                      <div className="max-h-48 overflow-y-auto space-y-1 bg-white rounded-xl p-1">
                        {addResults.map(p => (
                          <button key={p.id} onClick={() => setAddSelected(p)}
                            className="w-full text-left px-3 py-2 rounded-lg hover:bg-primary-50 transition-colors flex items-center gap-2">
                            <Package size={14} className="text-gray-400 flex-shrink-0" />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-gray-800 truncate">{p.name}</p>
                              {p.code && <p className="text-xs text-gray-400">{p.code}</p>}
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                    <button onClick={() => { setShowAdd(false); setAddSearch(''); setAddResults([]); }}
                      className="text-xs text-gray-500 hover:text-gray-700 font-medium">Отмена</button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 px-3 py-2 bg-white rounded-xl">
                      <Package size={14} className="text-primary-500 flex-shrink-0" />
                      <p className="text-sm font-medium text-gray-800 flex-1 truncate">{addSelected.name}</p>
                      <button onClick={() => setAddSelected(null)} className="text-gray-400 hover:text-gray-600"><X size={14} /></button>
                    </div>
                    <div className="flex items-end gap-3">
                      <div style={{ width: 100 }}>
                        <Input label="Кол-во" type="number" min="1" value={addQty} onChange={e => setAddQty(e.target.value)} />
                      </div>
                      <Button onClick={handleAddProduct} loading={addSaving} size="sm">Добавить</Button>
                      <Button variant="ghost" size="sm" onClick={() => { setShowAdd(false); setAddSelected(null); setAddSearch(''); setAddResults([]); setAddQty('1'); }}>Отмена</Button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {inventory.length === 0 && !showAdd ? (
              <div className="card p-8 text-center text-gray-300">
                <Package size={32} className="mx-auto mb-2 opacity-40" />
                <p className="text-sm">Нет товаров на руках</p>
              </div>
            ) : (
              <div className="space-y-2">
                {inventory.map(item => (
                  <div key={item.id} className="card p-4 flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-primary-50 flex items-center justify-center flex-shrink-0">
                      <Package size={18} className="text-primary-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-800 truncate">{item.product_name}</p>
                      {item.product_code && <p className="text-xs text-gray-400">{item.product_code}</p>}
                    </div>
                    {editItem?.product_id === item.product_id ? (
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <input type="number" min="0" step="1" value={editQty}
                          onChange={e => setEditQty(e.target.value)} autoFocus
                          onKeyDown={e => { if (e.key === 'Enter') handleSaveQty(); if (e.key === 'Escape') setEditItem(null); }}
                          className="w-16 text-center text-sm font-bold border border-primary-300 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-primary-300" />
                        <button onClick={handleSaveQty} disabled={saving} className="p-1 rounded-lg text-green-500 hover:bg-green-50">
                          {saving ? <Spinner size="xs" /> : <Check size={14} />}
                        </button>
                        <button onClick={() => setEditItem(null)} className="p-1 rounded-lg text-gray-400 hover:bg-gray-100"><X size={14} /></button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className="text-lg font-black text-primary-600">{qty(item.quantity)}</span>
                        <span className="text-xs text-gray-400">шт.</span>
                        <button onClick={() => { setEditItem(item); setEditQty(String(parseFloat(item.quantity))); }}
                          className="p-1 rounded-lg text-gray-400 hover:text-primary-500 hover:bg-primary-50 transition-all">
                          <Pencil size={13} />
                        </button>
                        <button onClick={() => handleDelete(item)}
                          className="p-1 rounded-lg text-gray-400 hover:text-rose-500 hover:bg-rose-50 transition-all">
                          <Trash2 size={13} />
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Access info */}
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Доступ</p>
            {employee.user_id ? (
              <div className="card p-4">
                <div className="flex items-center gap-4">
                  <div className="flex-1 min-w-0 grid grid-cols-3 gap-3">
                    <div>
                      <p className="text-xs text-gray-400">Логин</p>
                      <p className="text-sm font-mono font-medium text-gray-800">{employee.username}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-400">Роль</p>
                      <p className="text-sm font-medium text-gray-800">{employee.role === 'admin' ? 'Администратор' : employee.role === 'manager' ? 'Менеджер' : 'Сотрудник'}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-400">Статус</p>
                      <Badge variant={employee.user_active ? 'success' : 'default'} dot>{employee.user_active ? 'Активен' : 'Неактивен'}</Badge>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="card p-4 text-center text-gray-300">
                <p className="text-sm">Нет учётной записи</p>
              </div>
            )}
          </div>

          {/* Movement history */}
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
              История перемещений {history.length > 0 && <span className="text-primary-500 ml-1">({history.length})</span>}
            </p>
            {history.length === 0 ? (
              <p className="text-sm text-gray-300 text-center py-4">Нет перемещений</p>
            ) : (
              <div className="card overflow-hidden divide-y divide-gray-50">
                {history.map(m => {
                  const meta = getTypeMeta(m.movement_type);
                  const from = movFmtSource(m, 'from');
                  const to = movFmtSource(m, 'to');
                  return (
                    <div key={m.id} className="flex items-start gap-3 px-4 py-3">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium flex-shrink-0 mt-0.5 whitespace-nowrap ${meta.cls}`}>
                        {meta.label}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-800 truncate">{m.product_name || m.notes || '—'}</p>
                        <div className="flex items-center gap-1 mt-0.5 text-[10px] text-gray-400 flex-wrap">
                          {from && <span className="text-rose-400">{from}</span>}
                          {(from || to) && <span className="text-gray-300">→</span>}
                          {to && <span className="text-green-600">{to}</span>}
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-sm font-bold text-primary-600">{qty(m.quantity)} шт.</p>
                        <p className="text-[10px] text-gray-400">{fmtDateLocal(m.created_at)}</p>
                        {m.performer_name && <p className="text-[10px] text-gray-300">{m.performer_name.split(' ')[0]}</p>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
