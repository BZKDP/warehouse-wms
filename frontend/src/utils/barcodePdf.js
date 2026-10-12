/**
 * Генерация этикеток-штрихкодов как НАСТОЯЩЕГО PDF (6×4″).
 *
 * Раньше печать шла через popup с авто-`window.print()` и загрузкой JsBarcode
 * с CDN внутри окна — отсюда баги: гонка с загрузкой скрипта, блокировщики
 * popup, авто-закрытие окна (нельзя было просто открыть/сохранить PDF).
 *
 * Теперь штрихкод рисуется на canvas, собирается в jsPDF и открывается/скачивается
 * как обычный PDF, который можно посмотреть, сохранить и распечатать когда удобно.
 */

let depsPromise = null;

function loadScript(src, isReady) {
  if (isReady()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = () => {
      if (isReady()) resolve();
      else reject(new Error(`Скрипт ${src} загрузился, но зависимость недоступна`));
    };
    script.onerror = () => reject(new Error(`Не удалось загрузить ${src}`));
    document.head.appendChild(script);
  });
}

export async function ensureBarcodePdfDeps() {
  if (window.jspdf?.jsPDF && window.JsBarcode) {
    return { jsPDF: window.jspdf.jsPDF, JsBarcode: window.JsBarcode };
  }
  if (!depsPromise) {
    depsPromise = (async () => {
      await loadScript('https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js', () => !!window.jspdf?.jsPDF);
      await loadScript('https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js', () => !!window.JsBarcode);
      return { jsPDF: window.jspdf.jsPDF, JsBarcode: window.JsBarcode };
    })().catch((error) => {
      depsPromise = null;
      throw error;
    });
  }
  return depsPromise;
}

export function sanitizePdfFilename(value = 'etiketki') {
  const name = String(value ?? 'etiketki')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return `${name || 'etiketki'}.pdf`;
}

// Каждая этикетка — отдельная страница 6×4″: слева вертикальный код, справа штрихкод.
function buildLabelsPdf(items, { jsPDF, JsBarcode }) {
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'in', format: [4, 6] });
  items.forEach((item, index) => {
    if (index > 0) pdf.addPage([4, 6], 'landscape');

    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const leftWidth = 0.75;
    const canvas = document.createElement('canvas');

    JsBarcode(canvas, item.barcodeValue, {
      format: 'CODE128',
      width: 3.5,
      height: 130,
      displayValue: true,
      fontSize: 20,
      margin: 8,
      background: '#ffffff',
      lineColor: '#000000',
    });

    pdf.setDrawColor(0, 0, 0);
    pdf.setLineWidth(0.02);
    pdf.line(leftWidth, 0, leftWidth, pageHeight);

    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(28);
    pdf.text(String(item.labelText || ''), leftWidth / 2, pageHeight - 0.2, { angle: 90, align: 'center' });

    pdf.addImage(
      canvas.toDataURL('image/png'),
      'PNG',
      leftWidth + 0.2,
      0.5,
      pageWidth - leftWidth - 0.4,
      2.45,
      undefined,
      'FAST',
    );

    if (item.subText) {
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(14);
      pdf.text(String(item.subText), leftWidth + ((pageWidth - leftWidth) / 2), 3.55, {
        align: 'center',
        maxWidth: pageWidth - leftWidth - 0.5,
      });
    }
  });
  return pdf;
}

/**
 * Открыть этикетки как PDF в новой вкладке (просмотр / сохранение / печать).
 *
 * @param {Array<{barcodeValue,labelText,subText}>} items
 * @param {{win?: Window}} [opts]  win — уже открытая синхронно вкладка (чтобы обойти
 *                                  блокировщик popup); если не передать — откроется здесь.
 */
export async function openLabelsPdf(items, { win } = {}) {
  const printable = (items || []).filter((item) => item?.barcodeValue);
  if (!printable.length) {
    if (win && !win.closed) win.close();
    return { opened: 0, skipped: Array.isArray(items) ? items.length : 0, blocked: false };
  }
  const tab = win || window.open('', '_blank');
  try {
    const deps = await ensureBarcodePdfDeps();
    const pdf = buildLabelsPdf(printable, deps);
    const url = pdf.output('bloburl');
    if (tab) tab.location = url;
    else window.open(url, '_blank');
    return { opened: printable.length, skipped: (items?.length || 0) - printable.length, blocked: !tab };
  } catch (error) {
    if (tab && !tab.closed) tab.close();
    throw error;
  }
}

/** Скачать этикетки одним PDF-файлом. */
export async function downloadLabelsPdf(items, filename = 'etiketki.pdf') {
  const printable = (items || []).filter((item) => item?.barcodeValue);
  if (!printable.length) {
    return { downloaded: 0, skipped: Array.isArray(items) ? items.length : 0 };
  }
  const deps = await ensureBarcodePdfDeps();
  const pdf = buildLabelsPdf(printable, deps);
  pdf.save(sanitizePdfFilename(filename.replace(/\.pdf$/i, '')));
  return { downloaded: printable.length, skipped: (items?.length || 0) - printable.length };
}
