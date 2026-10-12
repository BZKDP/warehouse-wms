// ─── Единый словарь всех типов перемещений ──────────────────────────────────

export const TYPE_META = {
  // Полка ↔ Полка/Паллет
  shelf_to_shelf:           { label: 'Полка → Полка',           cls: 'bg-blue-100 text-blue-700' },
  shelf_to_pallet:          { label: 'Полка → Паллет',          cls: 'bg-purple-100 text-purple-700' },
  pallet_to_shelf:          { label: 'Паллет → Полка',          cls: 'bg-green-100 text-green-700' },
  pallet_to_pallet:         { label: 'Паллет → Паллет',         cls: 'bg-indigo-100 text-indigo-700' },
  // Сотрудник ↔ Полка/Паллет
  shelf_to_employee:        { label: 'Полка → Сотрудник',       cls: 'bg-orange-100 text-orange-700' },
  employee_to_shelf:        { label: 'Сотрудник → Полка',       cls: 'bg-cyan-100 text-cyan-700' },
  employee_to_pallet:       { label: 'Сотрудник → Паллет',      cls: 'bg-cyan-100 text-cyan-700' },
  pallet_to_employee:       { label: 'Паллет → Сотрудник',      cls: 'bg-amber-100 text-amber-700' },
  // Коробка ↔ Сотрудник
  box_to_employee:          { label: 'Коробка → Сотрудник',     cls: 'bg-orange-100 text-orange-700' },
  employee_to_box:          { label: 'Сотрудник → Коробка',     cls: 'bg-cyan-100 text-cyan-700' },
  // Коробка ↔ Полка/Паллет
  box_to_shelf:             { label: 'Коробка → Полка',         cls: 'bg-cyan-100 text-cyan-700' },
  box_to_pallet:            { label: 'Коробка → Паллет',        cls: 'bg-violet-100 text-violet-700' },
  shelf_to_box:             { label: 'Полка → Коробка',         cls: 'bg-fuchsia-100 text-fuchsia-700' },
  pallet_to_box:            { label: 'Паллет → Коробка',        cls: 'bg-fuchsia-100 text-fuchsia-700' },
  // Перенос коробки
  box_transfer:             { label: 'Перенос коробки',         cls: 'bg-indigo-100 text-indigo-700' },
  // Приходы
  external_to_shelf:        { label: 'Приход на полку',         cls: 'bg-emerald-100 text-emerald-700' },
  external_to_pallet:       { label: 'Приход на паллет',        cls: 'bg-emerald-100 text-emerald-700' },
  external_to_employee:     { label: 'Приход сотруднику',       cls: 'bg-emerald-100 text-emerald-700' },
  // Ручные правки
  edit_add_to_shelf:        { label: 'Добавление на полку',     cls: 'bg-sky-100 text-sky-700' },
  edit_remove_from_shelf:   { label: 'Списание с полки',        cls: 'bg-rose-100 text-rose-700' },
  edit_add_to_pallet:       { label: 'Добавление на паллет',    cls: 'bg-sky-100 text-sky-700' },
  edit_remove_from_pallet:  { label: 'Списание с паллета',      cls: 'bg-rose-100 text-rose-700' },
  edit_add_to_box:          { label: 'Добавление в коробку',    cls: 'bg-sky-100 text-sky-700' },
  edit_remove_from_box:     { label: 'Списание из коробки',     cls: 'bg-rose-100 text-rose-700' },
  // Корректировки
  pallet_correction_in:     { label: 'Коррекция +',             cls: 'bg-lime-100 text-lime-700' },
  pallet_correction_out:    { label: 'Коррекция −',             cls: 'bg-rose-100 text-rose-700' },
  employee_correction_in:   { label: 'Добавление сотруднику',   cls: 'bg-sky-100 text-sky-700' },
  employee_correction_out:  { label: 'Списание у сотрудника',   cls: 'bg-rose-100 text-rose-700' },
  // Списания
  employee_write_off:       { label: 'Списание',                cls: 'bg-rose-100 text-rose-700' },
  employee_writeoff:        { label: 'Списание',                cls: 'bg-rose-100 text-rose-700' },
  write_off:                { label: 'Списание',                cls: 'bg-rose-100 text-rose-700' },
  // Коробки
  box_create:               { label: 'Создание коробки',        cls: 'bg-green-100 text-green-700' },
  box_delete:               { label: 'Удаление коробки',        cls: 'bg-rose-100 text-rose-700' },
  box_product_change:       { label: 'Замена товара',           cls: 'bg-amber-100 text-amber-700' },
  // Сборка
  bundle_pick:              { label: 'Сборка (забор)',           cls: 'bg-orange-100 text-orange-700' },
  // Прочее
  manual_correction:        { label: 'Ручная коррекция',        cls: 'bg-amber-100 text-amber-700' },
  // shelf_movements_s operation types
  inventory:                { label: 'Инвентаризация',          cls: 'bg-blue-100 text-blue-700' },
  stock_in:                 { label: 'Приход',                  cls: 'bg-green-100 text-green-700' },
  stock_out:                { label: 'Списание',                cls: 'bg-rose-100 text-rose-700' },
  correction:               { label: 'Корректировка',           cls: 'bg-amber-100 text-amber-700' },
  transfer:                 { label: 'Перемещение',             cls: 'bg-blue-100 text-blue-700' },
};

const WORD_MAP = {
  shelf: 'Полка', pallet: 'Паллет', employee: 'Сотрудник', box: 'Коробка',
  external: 'Приход', edit: 'Ред.', add: 'Добавл.', remove: 'Списание',
  correction: 'Коррекция', write: 'Списание', off: '', to: '→', from: 'из',
  in: '+', out: '−', manual: 'Ручн.', transfer: 'Перенос', production: 'Производство',
  writeoff: 'Списание', stock: 'Склад',
};

export function translateType(t) {
  if (!t) return '?';
  return t.split('_').map(w => WORD_MAP[w] || w).filter(Boolean).join(' ');
}

export function getTypeMeta(t) {
  return TYPE_META[t] || { label: translateType(t), cls: 'bg-gray-100 text-gray-600' };
}

export function fmtSource(m, dir) {
  const code = m[`${dir}_shelf_code`] || m[`${dir}_shelf_name`];
  const pal  = m[`${dir}_pallet_name`];
  const emp  = m[`${dir}_employee_name`];
  const box  = m[`${dir}_box_barcode`];
  if (code) return `Полка ${code}`;
  if (pal)  return `Паллет ${pal}`;
  if (emp)  return emp;
  if (box)  return `Коробка ${box}`;
  return null;
}
