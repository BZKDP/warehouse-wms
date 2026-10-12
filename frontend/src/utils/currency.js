// Конвертация и форматирование валюты заработка.
// Внутри системы всё хранится в GRA. По умолчанию пользователю показываем рубли.
// 1 GRA = 0.01 ₽ (согласовано с admin/EarningsPage).

export const GRA_TO_RUB = 0.01;

export function graToRub(gra) {
  return Number(gra || 0) * GRA_TO_RUB;
}

// Форматирует число GRA как сумму в рублях. Округление до копеек.
export function formatRub(gra) {
  const rub = graToRub(gra);
  return new Intl.NumberFormat('ru-RU', {
    minimumFractionDigits: rub % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(rub);
}

// Форматирует число GRA в исходных единицах (без конвертации).
export function formatGra(gra) {
  const n = Number(gra || 0);
  return new Intl.NumberFormat('ru-RU', {
    minimumFractionDigits: 0,
    maximumFractionDigits: n % 1 === 0 ? 0 : 3,
  }).format(n);
}

// Универсальный форматтер с выбором единицы. По умолчанию — рубли.
export function formatMoney(gra, unit = 'rub') {
  return unit === 'gra' ? `${formatGra(gra)} GRA` : `${formatRub(gra)} ₽`;
}
