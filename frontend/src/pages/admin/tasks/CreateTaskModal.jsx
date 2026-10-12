import { useState, useEffect, useRef } from 'react';
import { Plus, X, Package, MapPin } from 'lucide-react';
import api from '../../../api/client';
import Button from '../../../components/ui/Button';
import Modal from '../../../components/ui/Modal';
import Input from '../../../components/ui/Input';
import Select from '../../../components/ui/Select';
import SearchSelect from '../../../components/ui/SearchSelect';
import CopyBadge from '../../../components/ui/CopyBadge';
import { useToast } from '../../../components/ui/Toast';

export default function CreateTaskModal({ open, onClose, onSuccess }) {
  const toast = useToast();
  const [taskType, setTaskType] = useState('inventory'); // 'inventory' | 'packaging'
  const [employees, setEmployees] = useState([]);
  // Inventory fields
  const [warehouses, setWarehouses] = useState([]);
  const [racks, setRacks] = useState([]);
  const [shelves, setShelves] = useState([]);
  const [inventoryShelfDetails, setInventoryShelfDetails] = useState(null);
  const [selectedShelfBoxIds, setSelectedShelfBoxIds] = useState([]);
  const [inventoryRows, setInventoryRows] = useState([]);
  const [inventoryPallets, setInventoryPallets] = useState([]);
  const [inventoryPalletDetails, setInventoryPalletDetails] = useState(null);
  const [selectedBoxIds, setSelectedBoxIds] = useState([]);
  const [selectedWarehouse, setSelectedWarehouse] = useState('');
  const [selectedRack, setSelectedRack] = useState('');
  const [selectedRow, setSelectedRow] = useState('');
  const [inventoryMode, setInventoryMode] = useState('shelf');
  const [form, setForm] = useState({ title: '', employee_id: '', shelf_id: '', target_pallet_id: '', notes: '' });
  // Packaging fields
  const [productSearch, setProductSearch] = useState('');
  const [productResults, setProductResults] = useState([]);
  const [selectedProduct, setSelectedProduct] = useState(null);
  // Production transfer fields
  const [transferForm, setTransferForm] = useState({ employee_id: '', notes: '' });
  const [transferProductSearch, setTransferProductSearch] = useState('');
  const [transferProductResults, setTransferProductResults] = useState([]);
  const [selectedTransferProduct, setSelectedTransferProduct] = useState(null);
  const [fboWarehouses, setFboWarehouses] = useState([]);
  const [pallets, setPallets] = useState([]);
  const [selectedFboWarehouse, setSelectedFboWarehouse] = useState('');
  const [packForm, setPackForm] = useState({ employee_id: '', box_size: '50', target_pallet_id: '', notes: '' });
  const [loading, setLoading] = useState(false);
  const [busyTargets, setBusyTargets] = useState({ shelves: {}, pallets: {}, pallet_boxes: {}, shelf_boxes: {} });
  const selectedWarehouseData = warehouses.find(w => String(w.id) === String(selectedWarehouse));
  const selectedInventoryShelf = shelves.find(s => String(s.id) === String(form.shelf_id));
  const selectedInventoryRow = inventoryRows.find(row => String(row.id) === String(selectedRow));
  const selectedInventoryPallet = inventoryPallets.find(p => String(p.id) === String(form.target_pallet_id));
  const isInventoryFbo = selectedWarehouseData?.warehouse_type === 'fbo';
  const isInventoryBoth = selectedWarehouseData?.warehouse_type === 'both';
  const inventoryUsesPallets = isInventoryFbo || (isInventoryBoth && inventoryMode === 'pallet');
  const inventoryUsesBoxes = inventoryUsesPallets
    ? (selectedInventoryPallet?.uses_boxes || inventoryPalletDetails?.uses_boxes)
    : (selectedInventoryShelf?.uses_boxes || inventoryShelfDetails?.uses_boxes);

  useEffect(() => {
    if (!open) return;
    Promise.all([
      api.get('/staff/employees'),
      api.get('/warehouse/warehouses'),
      api.get('/fbo/warehouses'),
      api.get('/tasks/busy-targets').catch(() => ({ data: { shelves: {}, pallets: {}, pallet_boxes: {}, shelf_boxes: {} } })),
    ]).then(([emp, wh, fbo, busy]) => {
      setEmployees((emp.data || []).filter(e => e.active !== false));
      setWarehouses(wh.data);
      setFboWarehouses(fbo.data);
      setBusyTargets(busy.data || { shelves: {}, pallets: {}, pallet_boxes: {}, shelf_boxes: {} });
    }).catch(console.error);
  }, [open]);

  useEffect(() => {
    if (!selectedWarehouseData) {
      setRacks([]);
      setShelves([]);
      setInventoryShelfDetails(null);
      setSelectedShelfBoxIds([]);
      setInventoryRows([]);
      setInventoryPallets([]);
      setInventoryPalletDetails(null);
      setSelectedBoxIds([]);
      return;
    }

    if (selectedWarehouseData.warehouse_type === 'fbo') {
      api.get(`/fbo/warehouses/${selectedWarehouse}`)
        .then(res => setInventoryRows(res.data.rows || []))
        .catch(console.error);
      setRacks([]);
      setShelves([]);
      setInventoryShelfDetails(null);
      setSelectedShelfBoxIds([]);
      setSelectedRack('');
      setSelectedRow('');
      setInventoryPallets([]);
      setInventoryPalletDetails(null);
      setSelectedBoxIds([]);
      setForm(f => ({ ...f, shelf_id: '', target_pallet_id: '' }));
      return;
    }

    api.get('/warehouse/racks', { params: { warehouse_id: selectedWarehouse } })
      .then(res => setRacks(res.data)).catch(console.error);
    setSelectedRack('');
    setShelves([]);
    setInventoryShelfDetails(null);
    setSelectedShelfBoxIds([]);
    setInventoryRows([]);
    setInventoryPallets([]);
    setInventoryPalletDetails(null);
    setSelectedBoxIds([]);
    setSelectedRow('');
    setForm(f => ({ ...f, shelf_id: '', target_pallet_id: '' }));
  }, [selectedWarehouse, selectedWarehouseData]);

  useEffect(() => {
    if (!selectedRack) { setShelves([]); return; }
    api.get(`/warehouse/racks/${selectedRack}`)
      .then(res => setShelves(res.data.shelves || [])).catch(console.error);
    setInventoryShelfDetails(null);
    setSelectedShelfBoxIds([]);
    setForm(f => ({ ...f, shelf_id: '' }));
  }, [selectedRack]);

  useEffect(() => {
    if (inventoryUsesPallets || !form.shelf_id) {
      setInventoryShelfDetails(null);
      setSelectedShelfBoxIds([]);
      return;
    }
    api.get(`/warehouse/shelves/${form.shelf_id}`)
      .then(res => {
        setInventoryShelfDetails(res.data);
        setSelectedShelfBoxIds([]);
      })
      .catch(console.error);
  }, [form.shelf_id, inventoryUsesPallets]);

  useEffect(() => {
    if (!selectedRow) { setInventoryPallets([]); setInventoryPalletDetails(null); setSelectedBoxIds([]); return; }
    api.get(`/fbo/rows/${selectedRow}`)
      .then(res => setInventoryPallets(res.data.pallets || []))
      .catch(console.error);
    setForm(f => ({ ...f, target_pallet_id: '' }));
  }, [selectedRow]);

  useEffect(() => {
    if (!inventoryUsesPallets || !form.target_pallet_id) {
      setInventoryPalletDetails(null);
      setSelectedBoxIds([]);
      return;
    }
    api.get(`/fbo/pallets/${form.target_pallet_id}`)
      .then(res => {
        setInventoryPalletDetails(res.data);
        setSelectedBoxIds([]);
      })
      .catch(console.error);
  }, [form.target_pallet_id, inventoryUsesPallets]);

  useEffect(() => {
    if (!isInventoryBoth) return;
    setSelectedRack('');
    setShelves([]);
    setInventoryShelfDetails(null);
    setSelectedShelfBoxIds([]);
    setSelectedRow('');
    setInventoryPallets([]);
    setInventoryPalletDetails(null);
    setSelectedBoxIds([]);
    setForm(f => ({ ...f, shelf_id: '', target_pallet_id: '' }));
  }, [inventoryMode, isInventoryBoth]);

  useEffect(() => {
    if (!selectedFboWarehouse) { setPallets([]); setPackForm(f => ({ ...f, target_pallet_id: '' })); return; }
    api.get('/fbo/pallets-list', { params: { warehouse_id: selectedFboWarehouse } })
      .then(res => setPallets(res.data)).catch(console.error);
  }, [selectedFboWarehouse]);

  // Product search debounce
  useEffect(() => {
    if (!productSearch.trim() || productSearch.length < 2) { setProductResults([]); return; }
    const t = setTimeout(() => {
      api.get('/products', { params: { search: productSearch, entity_type: 'product', limit: 8 } })
        .then(r => setProductResults(r.data.items || [])).catch(() => {});
    }, 300);
    return () => clearTimeout(t);
  }, [productSearch]);

  // Transfer product search
  useEffect(() => {
    if (!transferProductSearch.trim() || transferProductSearch.length < 2) { setTransferProductResults([]); return; }
    const t = setTimeout(() => {
      api.get('/products', { params: { search: transferProductSearch, entity_type: 'product', limit: 8 } })
        .then(r => setTransferProductResults(r.data.items || [])).catch(() => {});
    }, 300);
    return () => clearTimeout(t);
  }, [transferProductSearch]);

  const handleClose = () => {
    onClose();
    setTaskType('inventory');
    setForm({ title: '', employee_id: '', shelf_id: '', target_pallet_id: '', notes: '' });
    setSelectedWarehouse(''); setSelectedRack(''); setSelectedRow('');
    setInventoryMode('shelf');
    setInventoryShelfDetails(null); setSelectedShelfBoxIds([]);
    setInventoryRows([]); setInventoryPallets([]); setInventoryPalletDetails(null); setSelectedBoxIds([]);
    setSelectedProduct(null); setProductSearch(''); setProductResults([]);
    setPackForm({ employee_id: '', box_size: '50', target_pallet_id: '', notes: '' });
    setSelectedFboWarehouse('');
    setTransferForm({ employee_id: '', notes: '' });
    setSelectedTransferProduct(null); setTransferProductSearch(''); setTransferProductResults([]);
  };

  const handleSubmitTransfer = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const title = selectedTransferProduct
        ? `Перенос с производства: ${selectedTransferProduct.name}`
        : 'Перенос с производства';
      await api.post('/tasks', {
        title,
        task_type: 'production_transfer',
        product_id: selectedTransferProduct?.id || null,
        employee_id: transferForm.employee_id || null,
        notes: transferForm.notes || null,
      });
      toast.success('Задача переноса создана');
      onSuccess(); handleClose();
    } catch (err) { toast.error(err.response?.data?.error || 'Ошибка'); }
    finally { setLoading(false); }
  };

  const handleSubmitInventory = async (e) => {
    e.preventDefault();
    if (inventoryUsesPallets && !form.target_pallet_id) return toast.error('Выберите паллет');
    if (!inventoryUsesPallets && !form.shelf_id) return toast.error('Выберите полку');
    if (inventoryUsesBoxes && !inventoryUsesPallets && selectedShelfBoxIds.length === 0) return toast.error('Выберите хотя бы одну коробку');
    setLoading(true);
    try {
      // Shelf with boxes
      if (inventoryUsesBoxes && !inventoryUsesPallets && selectedShelfBoxIds.length > 0) {
        const freeShelfBoxIds = selectedShelfBoxIds.filter(id => !busyTargets.shelf_boxes[id]);
        if (freeShelfBoxIds.length === 0) { toast.error('Все выбранные коробки уже в работе'); setLoading(false); return; }
        await api.post('/tasks', {
          ...form,
          employee_id: form.employee_id || null,
          shelf_id: parseInt(form.shelf_id, 10),
          target_pallet_id: null,
          target_box_ids: [],
          target_shelf_box_ids: freeShelfBoxIds,
        });
        toast.success(`Задача создана на ${freeShelfBoxIds.length} коробок`);
      }
      // Pallet with specific boxes selected
      else if (inventoryUsesPallets && inventoryUsesBoxes && selectedBoxIds.length > 0) {
        const freeBoxIds = selectedBoxIds.filter(id => !busyTargets.pallet_boxes[id]);
        if (freeBoxIds.length === 0) { toast.error('Все выбранные коробки уже в работе'); setLoading(false); return; }
        await api.post('/tasks', {
          ...form,
          employee_id: form.employee_id || null,
          shelf_id: null,
          target_pallet_id: parseInt(form.target_pallet_id, 10),
          target_box_ids: freeBoxIds,
          target_shelf_box_ids: [],
        });
        toast.success(`Задача создана на ${freeBoxIds.length} коробок`);
      }
      // Pallet — all boxes (employee scans them)
      else {
        await api.post('/tasks', {
          ...form,
          employee_id: form.employee_id || null,
          shelf_id: inventoryUsesPallets ? null : (form.shelf_id || null),
          target_pallet_id: inventoryUsesPallets ? parseInt(form.target_pallet_id, 10) : null,
        });
        toast.success('Задача создана');
      }
      onSuccess(); handleClose();
    } catch (err) { toast.error(err.response?.data?.error || 'Ошибка'); }
    finally { setLoading(false); }
  };

  const handleSubmitPackaging = async (e) => {
    e.preventDefault();
    if (!selectedProduct) return toast.error('Выберите товар');
    if (!packForm.target_pallet_id) return toast.error('Выберите паллет');
    setLoading(true);
    try {
      await api.post('/tasks', {
        title: `Оприходование: ${selectedProduct.name}`,
        task_type: 'packaging',
        product_id: selectedProduct.id,
        box_size: parseInt(packForm.box_size) || 50,
        target_pallet_id: parseInt(packForm.target_pallet_id),
        employee_id: packForm.employee_id || null,
        notes: packForm.notes || null,
      });
      toast.success('Задача оприходования создана');
      onSuccess(); handleClose();
    } catch (err) { toast.error(err.response?.data?.error || 'Ошибка'); }
    finally { setLoading(false); }
  };

  const modalTitle = taskType === 'packaging' ? 'Создать задачу оприходования'
    : taskType === 'bundle_assembly' ? 'Создать задачу сборки комплектов'
    : 'Создать задачу инвентаризации';

  // Bundle assembly state
  const [bundles, setBundles] = useState([]);
  const [selectedBundle, setSelectedBundle] = useState(null);
  const [bundleQty, setBundleQty] = useState('10');
  const [bundleEmployee, setBundleEmployee] = useState('');
  const [bundleComponents, setBundleComponents] = useState([]);
  const [bundleSourcePaths, setBundleSourcePaths] = useState([]); // [{warehouse_id, pallet_id, label}]
  const [bundleEmployeeChoice, setBundleEmployeeChoice] = useState(false); // на усмотрение сотрудника
  const [bundleNotes, setBundleNotes] = useState('');
  const [bundleDestWh, setBundleDestWh] = useState('');
  const [bundleSearch, setBundleSearch] = useState('');
  const [bundleDropOpen, setBundleDropOpen] = useState(false);
  const [bundleDestList, setBundleDestList] = useState([]);
  const [bundleDestEmployeeChoice, setBundleDestEmployeeChoice] = useState(false);
  const [bundleAvailableLocations, setBundleAvailableLocations] = useState([]);
  const [bundleSourceByComponent, setBundleSourceByComponent] = useState({}); // {component_id: location}
  const [bundleSourceLoading, setBundleSourceLoading] = useState(false);
  // Destination cascading selectors
  const [destPickWh, setDestPickWh] = useState('');
  const [destPickRack, setDestPickRack] = useState('');
  const [destPickShelf, setDestPickShelf] = useState('');
  const [destPickRow, setDestPickRow] = useState('');
  const [destPickPallet, setDestPickPallet] = useState('');
  const [destRacks, setDestRacks] = useState([]);
  const [destShelves, setDestShelves] = useState([]);
  const [destRows, setDestRows] = useState([]);
  const [destPallets, setDestPallets] = useState([]);
  const destPickWhData = warehouses.find(w => String(w.id) === destPickWh);
  const [bundleSourceWh, setBundleSourceWh] = useState('');
  const [bundleSourcePallets, setBundleSourcePallets] = useState([]);
  const [bundleSourcePallet, setBundleSourcePallet] = useState('');

  // Load destination racks/rows when warehouse selected
  useEffect(() => {
    if (!destPickWh) { setDestRacks([]); setDestShelves([]); setDestRows([]); setDestPallets([]); return; }
    const whType = destPickWhData?.warehouse_type;
    if (whType === 'fbs' || whType === 'both') {
      api.get(`/warehouse/visual/${destPickWh}`).then(r => setDestRacks(Array.isArray(r.data) ? r.data : r.data?.racks || [])).catch(() => {
        // fallback: get racks from warehouse detail
        api.get(`/warehouse/warehouses/${destPickWh}`).then(r2 => setDestRacks(r2.data.racks || [])).catch(() => {});
      });
    }
    if (whType === 'fbo' || whType === 'both') {
      api.get(`/fbo/warehouses/${destPickWh}`).then(r => setDestRows(r.data.rows || [])).catch(() => {});
    }
  }, [destPickWh, destPickWhData?.warehouse_type]);

  useEffect(() => {
    if (!destPickRack) { setDestShelves([]); return; }
    // Load shelves from rack detail API
    api.get(`/warehouse/racks/${destPickRack}`).then(r => setDestShelves(r.data.shelves || [])).catch(() => setDestShelves([]));
  }, [destPickRack]);

  useEffect(() => {
    if (!destPickRow) { setDestPallets([]); return; }
    const row = destRows.find(r => String(r.id) === destPickRow);
    setDestPallets(row?.pallets || []);
  }, [destPickRow, destRows]);

  // Close bundle dropdown on outside click
  const bundleDropRef = useRef(null);
  useEffect(() => {
    if (!bundleDropOpen) return;
    const close = (e) => {
      if (bundleDropRef.current && !bundleDropRef.current.contains(e.target)) {
        setBundleDropOpen(false);
      }
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [bundleDropOpen]);

  // Load all bundles
  useEffect(() => {
    if (taskType !== 'bundle_assembly' || !open) return;
    api.get('/products?entity_type=bundle&limit=200')
      .then(r => setBundles(r.data.items || []))
      .catch(() => {});
  }, [taskType, open]);

  // Load components + available locations when bundle selected
  useEffect(() => {
    if (!selectedBundle) { setBundleComponents([]); setBundleAvailableLocations([]); setBundleSourceByComponent({}); return; }
    api.get(`/products/${selectedBundle.id}`)
      .then(r => {
        setBundleComponents(r.data.components || []);
        // Load locations where components are stored
        const componentIds = (r.data.components || []).map(c => c.id);
        if (componentIds.length > 0) {
          setBundleSourceLoading(true);
          api.get(`/assembly/source-locations?component_ids=${componentIds.join(',')}`)
            .then(lr => { setBundleAvailableLocations(lr.data || []); })
            .catch(() => setBundleAvailableLocations([]))
            .finally(() => setBundleSourceLoading(false));
        }
      })
      .catch(() => {});
  }, [selectedBundle]);

  // Load pallets when warehouse selected for source
  useEffect(() => {
    if (!bundleSourceWh) { setBundleSourcePallets([]); return; }
    api.get(`/fbo/warehouses/${bundleSourceWh}`)
      .then(r => {
        const allPallets = (r.data.rows || []).flatMap(row => (row.pallets || []).map(p => ({ ...p, row_name: row.name })));
        setBundleSourcePallets(allPallets);
      }).catch(() => {});
  }, [bundleSourceWh]);

  const addSourcePath = () => {
    if (!bundleSourcePallet) return;
    const p = bundleSourcePallets.find(x => String(x.id) === bundleSourcePallet);
    const wh = fboWarehouses.find(w => String(w.id) === bundleSourceWh);
    if (!p) return;
    setBundleSourcePaths(prev => [...prev, {
      pallet_id: p.id,
      label: `${wh?.name || ''} · ${p.row_name || ''} · ${p.name}`,
    }]);
    setBundleSourcePallet('');
  };

  const removeSourcePath = (idx) => setBundleSourcePaths(prev => prev.filter((_, i) => i !== idx));

  const handleSubmitAssembly = async (e) => {
    e.preventDefault();
    if (!selectedBundle) { toast.error('Выберите комплект'); return; }
    if (!bundleQty || Number(bundleQty) < 1) { toast.error('Укажите количество'); return; }
    setLoading(true);
    try {
      await api.post('/assembly', {
        bundle_product_id: selectedBundle.id,
        bundle_qty: Number(bundleQty),
        employee_id: bundleEmployee || null,
        source_boxes: bundleEmployeeChoice ? null : bundleSourcePaths.length > 0 ? bundleSourcePaths : null,
        notes: bundleNotes || null,
      });
      toast.success('Задача сборки создана');
      onSuccess();
      handleClose();
    } catch (err) { toast.error(err.response?.data?.error || 'Ошибка'); }
    finally { setLoading(false); }
  };

  return (
    <Modal open={open} onClose={handleClose}
      title={modalTitle}
      footer={<>
        <Button variant="ghost" onClick={handleClose}>Отмена</Button>
        <Button variant="primary-solid" form="task-form" type="submit" loading={loading}>Создать</Button>
      </>}
    >
      {/* Type selector */}
      <div className="flex gap-2 mb-5 flex-wrap">
        {[
          { value: 'inventory', label: '📋 Инвентаризация' },
          { value: 'packaging', label: '📦 Оприходование' },
          { value: 'bundle_assembly', label: '🔧 Сборка комплектов' },
          { value: 'production_transfer', label: '🚚 Перенос' },
        ].map(({ value, label }) => (
          <button key={value} type="button"
            onClick={() => setTaskType(value)}
            className={`flex-1 py-2 rounded-xl text-sm font-semibold border transition-all ${
              taskType === value ? 'bg-primary-600 text-white border-primary-600' : 'bg-white text-gray-600 border-gray-200 hover:border-primary-300'
            }`}
          >{label}</button>
        ))}
      </div>

      {taskType === 'inventory' ? (
        <form id="task-form" onSubmit={handleSubmitInventory} className="space-y-4">
          <Input label="Название задачи" placeholder="Инвентаризация стеллажа С5"
            value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} required />
          <SearchSelect label="Сотрудник" value={form.employee_id} placeholder="Поиск сотрудника..."
            onChange={v => setForm(f => ({ ...f, employee_id: v }))}
            options={[{ value: '', label: 'Не назначен' }, ...employees.map(emp => ({ value: String(emp.id), label: emp.full_name }))]}
          />
          <SearchSelect label="Склад" value={selectedWarehouse} placeholder="Поиск склада..."
            onChange={v => setSelectedWarehouse(v)}
            options={warehouses.map(w => ({ value: String(w.id), label: w.name }))}
          />
          {isInventoryBoth && (
            <SearchSelect label="Тип адресации" value={inventoryMode}
              onChange={v => setInventoryMode(v)}
              options={[{ value: 'shelf', label: 'Стеллажи и полки' }, { value: 'pallet', label: 'Ряды и паллеты' }]}
            />
          )}
          {selectedWarehouse && !inventoryUsesPallets && (
            <SearchSelect label="Стеллаж" value={selectedRack} placeholder="Поиск стеллажа..."
              onChange={v => setSelectedRack(v)}
              options={racks.map(r => ({ value: String(r.id), label: r.name }))}
            />
          )}
          {selectedRack && !inventoryUsesPallets && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Полка</label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-48 overflow-y-auto rounded-xl border border-gray-200 bg-gray-50 p-2">
                {shelves.map(s => {
                  const busy = busyTargets.shelves[s.id];
                  const selected = String(form.shelf_id) === String(s.id);
                  return (
                    <button key={s.id} type="button" disabled={!!busy}
                      onClick={() => setForm(f => ({ ...f, shelf_id: String(s.id) }))}
                      className={`text-left rounded-xl border px-3 py-2 text-sm transition-all ${
                        busy ? 'opacity-40 cursor-not-allowed border-gray-200 bg-gray-100' :
                        selected ? 'border-primary-400 bg-primary-50 ring-1 ring-primary-200' :
                        'border-gray-200 bg-white hover:border-primary-300 cursor-pointer'
                      }`}
                    >
                      <p className="font-medium text-gray-900 truncate">{s.name}</p>
                      <p className="text-xs text-gray-400 truncate">{s.code}{s.uses_boxes ? ' · коробки' : ''}</p>
                      {busy && <p className="text-[10px] text-rose-400 mt-0.5 truncate">В задаче #{busy.task_id}</p>}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {!inventoryUsesPallets && selectedInventoryShelf && (
            <div className={`rounded-xl border px-3 py-3 text-sm ${selectedInventoryShelf.uses_boxes ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-green-200 bg-green-50 text-green-800'}`}>
              {selectedInventoryShelf.uses_boxes
                ? 'На этой полке товар хранится в коробках. Для инвентаризации выбери нужные коробки.'
                : 'На этой полке товар хранится без коробок. Инвентаризация пройдёт по полке целиком.'}
            </div>
          )}
          {selectedWarehouse && inventoryUsesPallets && (
            <SearchSelect label="Ряд" value={selectedRow} placeholder="Поиск ряда..."
              onChange={v => setSelectedRow(v)}
              options={inventoryRows.map(row => ({ value: String(row.id), label: `Ряд ${row.number} — ${row.name}` }))}
            />
          )}
          {selectedRow && inventoryUsesPallets && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Паллет</label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-48 overflow-y-auto rounded-xl border border-gray-200 bg-gray-50 p-2">
                {inventoryPallets.map(p => {
                  const selected = String(form.target_pallet_id) === String(p.id);
                  const busyBoxCount = inventoryPalletDetails?.boxes?.filter(b => busyTargets.pallet_boxes[b.id])?.length || 0;
                  return (
                    <button key={p.id} type="button"
                      onClick={() => setForm(f => ({ ...f, target_pallet_id: String(p.id) }))}
                      className={`text-left rounded-xl border px-3 py-2 text-sm transition-all ${
                        selected ? 'border-primary-400 bg-primary-50 ring-1 ring-primary-200' :
                        'border-gray-200 bg-white hover:border-primary-300 cursor-pointer'
                      }`}
                    >
                      <p className="font-medium text-gray-900">Р{selectedInventoryRow?.number ?? ''}П{p.number}</p>
                      <p className="text-xs text-gray-400 truncate">{p.name}</p>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {inventoryUsesPallets && selectedInventoryPallet && !selectedInventoryPallet.uses_boxes && (
            <div className="rounded-xl border border-green-200 bg-green-50 px-3 py-3 text-sm text-green-800">
              На этом паллете товар хранится без коробок. Инвентаризация пройдёт по паллету целиком.
            </div>
          )}
          {inventoryUsesPallets && selectedInventoryPallet && selectedInventoryPallet.uses_boxes && inventoryPalletDetails && (
            <div className="space-y-3">
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
                Паллет с коробками ({inventoryPalletDetails.boxes?.length || 0} шт.)
              </div>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" name="boxMode" checked={selectedBoxIds.length === 0} onChange={() => setSelectedBoxIds([])}
                    className="w-4 h-4 text-primary-600" />
                  <span className="text-sm font-medium text-gray-700">Все коробки</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" name="boxMode" checked={selectedBoxIds.length > 0} onChange={() => setSelectedBoxIds(inventoryPalletDetails.boxes?.filter(b => !busyTargets.pallet_boxes[b.id]).map(b => b.id) || [])}
                    className="w-4 h-4 text-primary-600" />
                  <span className="text-sm font-medium text-gray-700">Выбрать конкретные</span>
                </label>
              </div>
              {selectedBoxIds.length > 0 && inventoryPalletDetails.boxes?.length > 0 && (
                <div className="max-h-56 overflow-y-auto grid grid-cols-1 sm:grid-cols-2 gap-2 rounded-xl border border-gray-200 bg-gray-50 p-2">
                  {inventoryPalletDetails.boxes.map(box => {
                    const busy = busyTargets.pallet_boxes[box.id];
                    const checked = !busy && selectedBoxIds.includes(box.id);
                    return (
                      <label key={box.id} className={`flex items-start gap-2.5 rounded-xl border px-3 py-2 text-sm transition-all ${
                        busy ? 'opacity-40 cursor-not-allowed border-gray-200 bg-gray-100' :
                        checked ? 'bg-white border-primary-200 cursor-pointer' :
                        'border-transparent hover:bg-white cursor-pointer'
                      }`}>
                        <input type="checkbox" checked={checked} disabled={!!busy}
                          onChange={() => !busy && setSelectedBoxIds(prev => checked ? prev.filter(id => id !== box.id) : [...prev, box.id])}
                          className="w-4 h-4 rounded text-primary-600 mt-0.5" />
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-gray-800 truncate">{box.product_name || 'Пустая коробка'}</p>
                          <p className="text-xs text-gray-400">{box.barcode_value} · {Number(box.quantity || 0)} шт.</p>
                          {busy && <p className="text-[10px] text-rose-400 mt-0.5">В задаче #{busy.task_id}</p>}
                        </div>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          )}
          {!inventoryUsesPallets && inventoryUsesBoxes && inventoryShelfDetails && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="block text-sm font-medium text-gray-700">Коробки на полке</label>
                {inventoryShelfDetails.boxes?.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      const available = inventoryShelfDetails.boxes.filter(b => !busyTargets.shelf_boxes[b.id]).map(b => b.id);
                      setSelectedShelfBoxIds(selectedShelfBoxIds.length === available.length ? [] : available);
                    }}
                    className="text-xs text-primary-600 hover:text-primary-700 font-medium"
                  >
                    {selectedShelfBoxIds.length === inventoryShelfDetails.boxes.filter(b => !busyTargets.shelf_boxes[b.id]).length ? 'Снять выбор' : 'Выбрать все'}
                  </button>
                )}
              </div>
              {inventoryShelfDetails.boxes?.length > 0 ? (
                <div className="max-h-56 overflow-y-auto grid grid-cols-1 sm:grid-cols-2 gap-2 rounded-xl border border-gray-200 bg-gray-50 p-2">
                  {inventoryShelfDetails.boxes.map(box => {
                    const busy = busyTargets.shelf_boxes[box.id];
                    const checked = !busy && selectedShelfBoxIds.includes(box.id);
                    return (
                      <label key={box.id} className={`flex items-start gap-3 rounded-xl border px-3 py-2 text-sm transition-all ${
                        busy ? 'opacity-40 cursor-not-allowed border-gray-200 bg-gray-100' :
                        checked ? 'border-primary-300 bg-white cursor-pointer' :
                        'border-transparent bg-transparent hover:bg-white cursor-pointer'
                      }`}>
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={!!busy}
                          onChange={() => !busy && setSelectedShelfBoxIds(prev => checked ? prev.filter(id => id !== box.id) : [...prev, box.id])}
                          className="mt-1"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-gray-900 truncate">
                            {box.name || 'Коробка'}
                          </p>
                          <p className="text-xs text-gray-500">
                            {box.barcode_value} · {Number(box.quantity || 0)} шт. · {Number(box.products_count || 0) > 1 ? `${Number(box.products_count)} товара` : (box.product_name || 'Пустая коробка')}
                          </p>
                          {busy && <p className="text-[10px] text-rose-400 mt-0.5">В задаче #{busy.task_id}</p>}
                        </div>
                      </label>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-gray-300 px-3 py-4 text-sm text-gray-500">
                  На полке пока нет коробок. Сначала создай их в разделе склада.
                </div>
              )}
            </div>
          )}
          <Input label="Примечание" placeholder="Дополнительные инструкции..."
            value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
        </form>
      ) : taskType === 'packaging' ? (
        <form id="task-form" onSubmit={handleSubmitPackaging} className="space-y-4">
          {/* Product selection */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Товар *</label>
            {selectedProduct ? (
              <div className="flex items-center gap-3 p-3 bg-primary-50 rounded-xl border border-primary-100">
                <Package size={16} className="text-primary-500 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{selectedProduct.name}</p>
                  <p className="text-xs text-gray-400">{selectedProduct.code}</p>
                </div>
                <button type="button" onClick={() => { setSelectedProduct(null); setProductSearch(''); }}
                  className="text-gray-400 hover:text-rose-500 flex-shrink-0 text-xs">✕</button>
              </div>
            ) : (
              <div className="relative">
                <Input placeholder="Поиск товара..." value={productSearch}
                  onChange={e => setProductSearch(e.target.value)} autoFocus />
                {productResults.length > 0 && (
                  <div className="absolute top-full left-0 right-0 z-50 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden max-h-48 overflow-y-auto">
                    {productResults.map(p => (
                      <button key={p.id} type="button" onClick={() => { setSelectedProduct(p); setProductSearch(''); setProductResults([]); }}
                        className="w-full text-left px-3 py-2.5 hover:bg-gray-50 text-sm">
                        <p className="font-medium truncate">{p.name}</p>
                        <p className="text-xs text-gray-400">{p.code}</p>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          <Input label="Штук в коробке" type="number" min="1" max="1000"
            value={packForm.box_size} onChange={e => setPackForm(f => ({ ...f, box_size: e.target.value }))} required />
          <SearchSelect label="Паллетный склад" value={selectedFboWarehouse} placeholder="Поиск паллетного склада..."
            onChange={v => setSelectedFboWarehouse(v)}
            options={fboWarehouses.map(w => ({ value: String(w.id), label: w.name }))}
          />
          {selectedFboWarehouse && (
            <SearchSelect label="Паллет" value={packForm.target_pallet_id} placeholder="Поиск паллета..."
              onChange={v => setPackForm(f => ({ ...f, target_pallet_id: v }))}
              options={pallets.map(p => ({ value: String(p.id), label: `Р${p.row_number}П${p.number} — ${p.name}` }))}
            />
          )}
          <SearchSelect label="Сотрудник" value={packForm.employee_id} placeholder="Поиск сотрудника..."
            onChange={v => setPackForm(f => ({ ...f, employee_id: v }))}
            options={[{ value: '', label: 'Не назначен' }, ...employees.map(emp => ({ value: String(emp.id), label: emp.full_name }))]}
          />
          <Input label="Примечание" placeholder="Дополнительные инструкции..."
            value={packForm.notes} onChange={e => setPackForm(f => ({ ...f, notes: e.target.value }))} />
        </form>
      ) : taskType === 'bundle_assembly' ? (
        <form id="task-form" onSubmit={handleSubmitAssembly} className="space-y-4">
          {/* 1. Комплект */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Комплект *</label>
            {selectedBundle ? (
              <div className="flex items-center gap-3 p-3 bg-green-50 rounded-xl border border-green-100">
                <Package size={16} className="text-green-500 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{selectedBundle.name}</p>
                  <p className="text-xs text-gray-400">{selectedBundle.code}</p>
                </div>
                <button type="button" onClick={() => { setSelectedBundle(null); setBundleSearch(''); }}
                  className="text-gray-400 hover:text-rose-500"><X size={14} /></button>
              </div>
            ) : (
              <div className="relative" ref={bundleDropRef}>
                <input value={bundleSearch} onChange={e => { setBundleSearch(e.target.value); setBundleDropOpen(true); }}
                  onFocus={() => setBundleDropOpen(true)}
                  placeholder="Начните вводить или выберите..."
                  className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:border-primary-400 focus:ring-2 focus:ring-primary-100 focus:outline-none" />
                {bundleDropOpen && (
                  <div className="absolute z-20 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg max-h-52 overflow-y-auto">
                    {bundles.filter(b => !bundleSearch || b.name.toLowerCase().includes(bundleSearch.toLowerCase())).length === 0 ? (
                      <p className="px-3 py-3 text-sm text-gray-400 text-center">Комплекты не найдены</p>
                    ) : bundles.filter(b => !bundleSearch || b.name.toLowerCase().includes(bundleSearch.toLowerCase())).map(b => (
                      <button key={b.id} type="button" onClick={() => { setSelectedBundle(b); setBundleSearch(''); setBundleDropOpen(false); }}
                        className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-primary-50 text-sm transition-colors border-b border-gray-50 last:border-0">
                        <Package size={14} className="text-primary-400 flex-shrink-0" />
                        <span className="font-medium text-gray-800 truncate flex-1">{b.name}</span>
                        <span className="text-xs text-gray-400 flex-shrink-0">{b.code}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {bundleComponents.length > 0 && (
            <div className="bg-gray-50 rounded-xl p-3">
              <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Состав:</p>
              {bundleComponents.map(c => (
                <div key={c.id || c.bc_id} className="flex justify-between py-1 text-sm">
                  <span className="text-gray-800 truncate">{c.name}</span>
                  <span className="font-bold text-gray-600 flex-shrink-0">× {Number(c.quantity) || 1}</span>
                </div>
              ))}
            </div>
          )}

          {/* 2. Количество */}
          <Input label="Количество комплектов *" type="number" min="1" value={bundleQty}
            onChange={e => setBundleQty(e.target.value)} required />

          {/* 3. Откуда брать */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Откуда брать</label>
            <label className="flex items-center gap-2 mb-3 cursor-pointer">
              <input type="checkbox" checked={bundleEmployeeChoice} onChange={e => setBundleEmployeeChoice(e.target.checked)}
                className="w-4 h-4 rounded border-gray-300 text-primary-500 focus:ring-primary-400" />
              <span className="text-sm text-gray-600">На усмотрение сотрудника</span>
            </label>
            {!bundleEmployeeChoice && selectedBundle && bundleComponents.length > 0 && (
              <div className="space-y-2">
                {bundleComponents.map(comp => {
                  const compId = comp.id;
                  const compLocs = bundleAvailableLocations.filter(l => l.product_id === compId || l.product_name === comp.name);
                  const selected = bundleSourceByComponent[compId];
                  return (
                    <div key={compId} className="border border-gray-100 rounded-xl overflow-hidden">
                      {/* Component header */}
                      <div className="flex items-center gap-2 px-3 py-2 bg-gray-50">
                        <Package size={14} className="text-primary-400 flex-shrink-0" />
                        <span className="text-sm font-medium text-gray-800 flex-1 truncate">{comp.name}</span>
                        <span className="text-xs text-gray-400">× {Number(comp.quantity) || 1}</span>
                      </div>
                      {/* Selected source or picker */}
                      <div className="px-3 py-2">
                        {selected ? (
                          <div className="flex items-center gap-2 px-2 py-1.5 bg-green-50 border border-green-100 rounded-lg">
                            <MapPin size={12} className="text-green-500 flex-shrink-0" />
                            <span className="text-xs text-green-800 flex-1 truncate">{selected.path}</span>
                            <span className="text-xs text-green-600">{selected.qty} шт</span>
                            <button type="button" onClick={() => setBundleSourceByComponent(prev => { const n = { ...prev }; delete n[compId]; return n; })}
                              className="text-gray-400 hover:text-rose-500"><X size={12} /></button>
                          </div>
                        ) : bundleSourceLoading ? (
                          <p className="text-xs text-gray-400">Загрузка...</p>
                        ) : compLocs.length === 0 ? (
                          <p className="text-xs text-amber-500">Не найден на складах</p>
                        ) : (
                          <div className="max-h-28 overflow-y-auto space-y-1">
                            {compLocs.map((loc, i) => (
                              <button key={i} type="button" onClick={() => setBundleSourceByComponent(prev => ({ ...prev, [compId]: loc }))}
                                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-primary-50 text-left transition-colors">
                                <MapPin size={12} className="text-gray-400 flex-shrink-0" />
                                <span className="text-xs text-gray-700 flex-1 truncate">{loc.path}</span>
                                <span className="text-xs text-gray-400">{loc.qty} шт</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* 4. Сотрудник */}
          <SearchSelect label="Сотрудник" value={bundleEmployee} placeholder="Выберите сотрудника..."
            onChange={v => setBundleEmployee(v)}
            options={employees.map(e => ({ value: String(e.id), label: e.full_name }))} />

          {/* 5. Куда положить */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Куда положить</label>

            {/* Selected destinations */}
            {bundleDestList.map((d, i) => (
              <div key={i} className="flex items-center gap-2 mb-2 px-3 py-2 bg-blue-50 border border-blue-100 rounded-xl">
                <MapPin size={14} className="text-blue-500 flex-shrink-0" />
                <span className="text-sm text-gray-800 flex-1">{d.label}</span>
                <button type="button" onClick={() => setBundleDestList(prev => prev.filter((_, j) => j !== i))} className="text-gray-400 hover:text-rose-500"><X size={14} /></button>
              </div>
            ))}

            {/* Cascading selector: warehouse → rack/row → shelf/pallet */}
            <div className="space-y-2 mb-2">
              <SearchSelect value={destPickWh} placeholder="Склад..."
                onChange={v => { setDestPickWh(v); setDestPickRack(''); setDestPickRow(''); setDestPickShelf(''); setDestPickPallet(''); }}
                options={warehouses.filter(w => w.active !== false).map(w => ({ value: String(w.id), label: w.name }))} />

              {destPickWh && destPickWhData && (destPickWhData.warehouse_type === 'fbs' || destPickWhData.warehouse_type === 'both') && (
                <div className="flex gap-2">
                  <div className="flex-1">
                    <SearchSelect value={destPickRack} placeholder="Стеллаж..."
                      onChange={v => { setDestPickRack(v); setDestPickShelf(''); }}
                      options={destRacks.map(r => ({ value: String(r.id), label: r.name }))} />
                  </div>
                  {destPickRack && (
                    <div className="flex-1">
                      <SearchSelect value={destPickShelf} placeholder="Полка..."
                        onChange={v => setDestPickShelf(v)}
                        options={destShelves.map(s => ({ value: String(s.id), label: s.code || s.name }))} />
                    </div>
                  )}
                </div>
              )}

              {destPickWh && destPickWhData && (destPickWhData.warehouse_type === 'fbo' || destPickWhData.warehouse_type === 'both') && (
                <div className="flex gap-2">
                  <div className="flex-1">
                    <SearchSelect value={destPickRow} placeholder="Ряд..."
                      onChange={v => { setDestPickRow(v); setDestPickPallet(''); }}
                      options={destRows.map(r => ({ value: String(r.id), label: r.name }))} />
                  </div>
                  {destPickRow && (
                    <div className="flex-1">
                      <SearchSelect value={destPickPallet} placeholder="Паллет..."
                        onChange={v => setDestPickPallet(v)}
                        options={destPallets.map(p => ({ value: String(p.id), label: p.name }))} />
                    </div>
                  )}
                </div>
              )}

              {destPickWh && (
                <Button type="button" variant="outline" size="sm" icon={<Plus size={14} />} onClick={() => {
                  const wh = warehouses.find(w => String(w.id) === destPickWh);
                  let label = wh?.name || '';
                  if (destPickRack) { const r = destRacks.find(x => String(x.id) === destPickRack); if (r) label += ` → ${r.name}`; }
                  if (destPickShelf) { const s = destShelves.find(x => String(x.id) === destPickShelf); if (s) label += ` → ${s.code || s.name}`; }
                  if (destPickRow) { const r = destRows.find(x => String(x.id) === destPickRow); if (r) label += ` → ${r.name}`; }
                  if (destPickPallet) { const p = destPallets.find(x => String(x.id) === destPickPallet); if (p) label += ` → ${p.name}`; }
                  setBundleDestList(prev => [...prev, { label, warehouse_id: destPickWh, shelf_id: destPickShelf || null, pallet_id: destPickPallet || null }]);
                  setDestPickWh(''); setDestPickRack(''); setDestPickShelf(''); setDestPickRow(''); setDestPickPallet('');
                }}>Добавить место</Button>
              )}
            </div>

            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={bundleDestEmployeeChoice} onChange={e => setBundleDestEmployeeChoice(e.target.checked)}
                className="w-4 h-4 rounded border-gray-300 text-primary-500 focus:ring-primary-400" />
              <span className="text-sm text-gray-600">Остаток на усмотрение сотрудника</span>
            </label>
          </div>

          {/* 6. Примечание */}
          <Input label="Примечание" placeholder="Инструкции для сотрудника..."
            value={bundleNotes} onChange={e => setBundleNotes(e.target.value)} />
        </form>
      ) : taskType === 'production_transfer' ? (
        <form id="task-form" onSubmit={handleSubmitTransfer} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Товар (необязательно)</label>
            <Input placeholder="Поиск товара..." value={transferProductSearch} onChange={e => setTransferProductSearch(e.target.value)} />
            {transferProductResults.length > 0 && (
              <div className="mt-1 max-h-32 overflow-y-auto border border-gray-100 rounded-xl p-1">
                {transferProductResults.map(p => (
                  <button key={p.id} type="button" onClick={() => { setSelectedTransferProduct(p); setTransferProductSearch(''); setTransferProductResults([]); }}
                    className="w-full text-left px-3 py-1.5 rounded-lg text-sm hover:bg-primary-50 truncate">{p.name}</button>
                ))}
              </div>
            )}
            {selectedTransferProduct && (
              <div className="mt-2 flex items-center gap-2 px-3 py-2 bg-primary-50 rounded-xl border border-primary-100">
                <span className="text-sm font-medium truncate flex-1">{selectedTransferProduct.name}</span>
                <button type="button" onClick={() => setSelectedTransferProduct(null)} className="text-gray-400 hover:text-rose-500"><X size={14} /></button>
              </div>
            )}
          </div>
          <Select label="Сотрудник" value={transferForm.employee_id} onChange={e => setTransferForm(f => ({ ...f, employee_id: e.target.value }))}>
            <option value="">Не назначен</option>
            {employees.map(e => <option key={e.id} value={e.id}>{e.full_name}</option>)}
          </Select>
          <Input label="Примечание" placeholder="Что перенести, откуда, куда..."
            value={transferForm.notes} onChange={e => setTransferForm(f => ({ ...f, notes: e.target.value }))} />
        </form>
      ) : null}
    </Modal>
  );
}
