import { openLabelsPdf } from './barcodePdf';

/**
 * Открывает этикетку штрихкода 6×4″ как НАСТОЯЩИЙ PDF в новой вкладке
 * (слева вертикальный код, справа штрихкод).
 *
 * Раньше открывался popup с авто-`window.print()` и закрытием окна — отсюда баги
 * (гонка с CDN, блокировщики, нельзя было просто открыть/сохранить). Теперь это
 * обычный PDF: его видно, можно сохранить и распечатать когда удобно.
 *
 * @param {string} barcodeValue  — значение для кодирования
 * @param {string} labelText     — текст слева (вертикально), например "С1П3"
 * @param {string} [subText]     — подпись под штрихкодом, например "Склад Ижевск"
 */
export function printBarcode(barcodeValue, labelText, subText = '') {
  // Вкладку открываем синхронно в обработчике клика — иначе блокировщик popup
  // отменит её после await загрузки jsPDF.
  const win = window.open('', '_blank');
  openLabelsPdf([{ barcodeValue, labelText, subText }], { win }).catch((err) => {
    console.error('[printBarcode] не удалось сформировать PDF этикетки:', err);
    if (win && !win.closed) win.close();
    alert('Не удалось сформировать PDF этикетки. Проверьте подключение к интернету и попробуйте снова.');
  });
}
