import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { qty } from '../../../utils/fmt';
import { ArrowLeft, Pencil, Trash2, Copy, Check, Printer, ArrowDown } from 'lucide-react';
import { BoxIcon, ProductIcon } from '../../../components/ui/WarehouseIcons';
import api from '../../../api/client';
import Spinner from '../../../components/ui/Spinner';
import Badge from '../../../components/ui/Badge';
import Barcode from '../../../components/ui/Barcode';
import Button from '../../../components/ui/Button';
import { useToast } from '../../../components/ui/Toast';
import {
  getShelfBoxLabel, getPalletBoxLabel,
  printShelfBoxBarcode, printPalletBoxBarcode,
  downloadBarcodesPdfBatch,
  LocationHistory,
} from './warehouseUtils';
import { BoxEditorModal } from './WarehouseModals';

export function BoxDetailView({ boxId, boxType, onClose, onChanged }) {
  const [, setSearchParams] = useSearchParams();
  const toast = useToast();
  const [box, setBox] = useState(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [movements, setMovements] = useState([]);
  const [movMode, setMovMode] = useState('grouped');

  const isShelfBox = boxType === 'shelf';
  const isStandalone = boxType === 'standalone';

  const load = useCallback(async () => {
    if (!boxId) return;
    setLoading(true);
    try {
      const res = await api.get(isShelfBox ? `/warehouse/shelf-boxes/${boxId}` : `/fbo/boxes/${boxId}`);
      setBox(res.data);
      // Load box movement history independently
      api.get(`/warehouse/box-movements?box_id=${boxId}&box_type=${isShelfBox ? 'shelf' : 'pallet'}&limit=200`)
        .then(r => setMovements(r.data || []))
        .catch(() => setMovements([]));
    } catch {
      toast.error('Ошибка загрузки коробки');
    } finally {
      setLoading(false);
    }
  }, [boxId, isShelfBox]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    setSearchParams(prev => {
      const p = new URLSearchParams(prev);
      p.set('box', boxId);
      p.set('boxtype', boxType);
      return p;
    });
    return () => {
      setSearchParams(prev => {
        const p = new URLSearchParams(prev);
        p.delete('box');
        p.delete('boxtype');
        return p;
      });
    };
  }, [boxId, boxType, setSearchParams]);

  const boxLabel = isShelfBox
    ? getShelfBoxLabel(box, { code: box?.shelf_code, name: box?.shelf_name })
    : getPalletBoxLabel(box, { row_number: box?.row_number, number: box?.pallet_number, name: box?.pallet_name });
  const canSingleEdit = !box?.items || box.items.length <= 1;

  const handleCopy = () => {
    navigator.clipboard.writeText(box?.barcode_value || '');
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handlePrint = () => {
    if (!box) return;
    if (isShelfBox) {
      printShelfBoxBarcode(box, { code: box.shelf_code, name: box.shelf_name });
    } else {
      printPalletBoxBarcode(box, { row_number: box.row_number, number: box.pallet_number, name: box.pallet_name });
    }
  };

  const handleDownload = async () => {
    if (!box) return;
    try {
      const result = await downloadBarcodesPdfBatch([{
        barcodeValue: box.barcode_value,
        labelText: boxLabel,
        subText: isShelfBox
          ? (box.shelf_code || box.shelf_name || '')
          : (box.pallet_name || ''),
      }], boxLabel);
      if (!result.downloaded) {
        toast.error('У коробки нет штрих-кода для скачивания');
        return;
      }
      toast.success('PDF скачан');
    } catch (err) {
      toast.error('Не удалось скачать PDF');
    }
  };

  const handleSave = async (payload) => {
    if (payload.quantity > 0 && !payload.product_id) {
      toast.error('Для непустой коробки выберите товар');
      return;
    }
    setSaving(true);
    try {
      await api.put(isShelfBox ? `/warehouse/shelf-boxes/${boxId}` : `/fbo/boxes/${boxId}`, payload);
      toast.success('Коробка обновлена');
      setEditing(false);
      await load();
      onChanged?.();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Ошибка');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm(`Удалить коробку "${boxLabel}"?`)) return;
    try {
      await api.delete(isShelfBox ? `/warehouse/shelf-boxes/${boxId}` : `/fbo/boxes/${boxId}`);
      toast.success('Коробка удалена');
      onChanged?.();
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Ошибка');
    }
  };

  if (loading) return <div className="flex items-center justify-center h-40"><Spinner size="lg" /></div>;
  if (!box) return null;

  const locationRows = isShelfBox
    ? [
        { label: 'Склад', value: box.warehouse_name || '—' },
        { label: 'Стеллаж', value: box.rack_code || box.rack_name || '—' },
        { label: 'Полка', value: box.shelf_code || box.shelf_name || '—' },
        { label: 'Коробка', value: boxLabel },
      ]
    : isStandalone
    ? [
        { label: 'Склад', value: box.warehouse_name || '—' },
        { label: 'Коробка', value: boxLabel },
      ]
    : [
        { label: 'Склад', value: box.warehouse_name || '—' },
        { label: 'Ряд', value: box.row_number ? `Р${box.row_number}` : (box.row_name || '—') },
        { label: 'Паллет', value: box.pallet_number ? `Р${box.row_number}П${box.pallet_number}` : (box.pallet_name || '—') },
        { label: 'Коробка', value: boxLabel },
      ];

  return (
    <div>
      <div className="flex items-center gap-3 mb-5">
        <button onClick={onClose}
          className="p-2 rounded-xl text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-all">
          <ArrowLeft size={18} />
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white">{boxLabel}</h2>
            <Badge variant="warning">Коробка</Badge>
            {!isShelfBox && (
              <Badge variant={box.status === 'open' ? 'warning' : 'success'}>
                {box.status === 'open' ? 'Открыта' : 'Закрыта'}
              </Badge>
            )}
          </div>
          <p className="text-sm text-gray-400">
            {box.items?.length > 1
              ? `${box.items.length} товара внутри коробки`
              : box.product_name
              ? `${box.product_name}${box.product_code ? ` · ${box.product_code}` : ''}`
              : 'Пустая коробка'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canSingleEdit && (
            <button onClick={() => setEditing(true)}
              className="p-2 rounded-xl text-gray-400 hover:text-primary-600 hover:bg-primary-50 transition-all">
              <Pencil size={15} />
            </button>
          )}
          <button onClick={handleDelete}
            className="p-2 rounded-xl text-gray-400 hover:text-rose-500 hover:bg-rose-50 transition-all">
            <Trash2 size={15} />
          </button>
        </div>
      </div>

      <div className="card p-4 mb-5">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Штрих-код коробки</p>
        <div className="flex items-center justify-center bg-white dark:bg-gray-800 rounded-xl p-3 border border-gray-100 dark:border-gray-700 mb-3">
          <Barcode value={box.barcode_value} height={55} />
        </div>
        <div className="flex items-center gap-2 bg-gray-50 dark:bg-gray-800 rounded-xl px-3 py-2">
          <code className="flex-1 text-sm font-mono text-gray-700 dark:text-gray-300">{box.barcode_value}</code>
          <button onClick={handleCopy} className="p-1 rounded text-gray-400 hover:text-primary-600 transition-colors">
            {copied ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
          </button>
          <button onClick={handleDownload} className="p-1 rounded text-gray-400 hover:text-primary-600 transition-colors">
            <ArrowDown size={14} />
          </button>
          <button onClick={handlePrint} className="p-1 rounded text-gray-400 hover:text-primary-600 transition-colors">
            <Printer size={14} />
          </button>
        </div>
      </div>

      <div className="card p-4 mb-5">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Адрес ячейки</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {locationRows.map(row => (
            <div key={row.label} className="rounded-xl bg-gray-50 dark:bg-gray-800 px-3 py-2">
              <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">{row.label}</p>
              <p className="text-sm font-medium text-gray-800 dark:text-gray-200 mt-1 break-words">{row.value}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="card p-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Содержимое</p>
          {canSingleEdit ? (
            <Button size="sm" onClick={() => setEditing(true)} icon={<Pencil size={14} />}>
              {box.product_id ? 'Изменить' : 'Заполнить'}
            </Button>
          ) : (
            <span className="text-xs text-amber-600">Смешанная коробка редактируется только через инвентаризацию</span>
          )}
        </div>

        {box.items?.length > 0 ? (
          <div className="space-y-2">
            {box.items.map(item => (
              <div key={item.product_id} className="rounded-xl bg-gray-50 dark:bg-gray-800 p-3 flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-white dark:bg-gray-700 flex items-center justify-center flex-shrink-0 border border-gray-100 dark:border-gray-600">
                  <ProductIcon size={18} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{item.product_name}</p>
                  <p className="text-xs text-gray-400">{item.product_code || '—'}</p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-xs text-gray-400">Количество</p>
                  <p className="text-lg font-bold text-gray-900 dark:text-white">{qty(item.quantity)} шт.</p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-8 text-gray-300 bg-gray-50 dark:bg-gray-800 rounded-xl">
            <BoxIcon size={36} className="mx-auto mb-2 opacity-40" />
            <p className="text-sm">Коробка пустая</p>
          </div>
        )}
      </div>

      <LocationHistory movements={movements} mode={movMode} onModeChange={setMovMode} title="История коробки" />

      <BoxEditorModal
        open={editing}
        onClose={() => setEditing(false)}
        box={box}
        title={box.product_id || box.items?.length > 0 ? 'Редактировать коробку' : 'Заполнить коробку'}
        onSave={handleSave}
        loading={saving}
      />
    </div>
  );
}
