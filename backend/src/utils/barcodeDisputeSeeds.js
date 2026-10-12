// Спорные ситуации, обнаруженные при сверке GRAсклада, базы знаний,
// Google-таблицы этикеток и истории сканирований 26.08.2026.
// Сидирование идемпотентное: принятые решения не перезаписываются.
const KNOWN_BARCODE_DISPUTES = [
  {
    issueKey: 'barcode:400000000282',
    issueType: 'barcode_owner',
    severity: 'critical',
    primaryBarcode: '400000000282',
    title: 'Одна этикетка используется двумя товарами',
    description: 'Код временно разрешён для двух карточек. Нужно выбрать единственный GRA-артикул, которому принадлежит производственная этикетка.',
    recommendedOptionId: 'owner-gra-04570',
    options: [
      {
        id: 'owner-gra-04570', action: 'assign_production_barcode',
        article: 'GRA-04570', barcode: '400000000282', label: 'GRA-04570',
        detail: 'Астаксантин 20 мг, 60 капсул',
      },
      {
        id: 'owner-gra-11900', action: 'assign_production_barcode',
        article: 'GRA-11900', barcode: '400000000282', label: 'GRA-11900',
        detail: 'Астаксантин + Q10 + PQQ + МСТ, 60 капсул',
      },
    ],
    evidence: [
      { source: 'Google-таблица', tone: 'support', text: 'В строке GRA-04570 указан штрихкод 400000000282.' },
      { source: 'История сканов', tone: 'support', text: 'GRA-04570 — 10 918 сканов; GRA-11900 — 355 временных сканов.' },
      { source: 'База знаний', tone: 'warning', text: 'Собственная этикетка GRA-11900 не найдена.' },
    ],
  },
  {
    issueKey: 'production:GRA-00180',
    issueType: 'production_barcode',
    severity: 'high',
    subjectArticle: 'GRA-00180',
    title: 'Два кандидата на производственный штрихкод',
    description: 'В карточке и базе знаний указаны разные коды. Оба встречались в реальных сканированиях этого товара.',
    recommendedOptionId: 'current-2000000326269',
    options: [
      {
        id: 'current-2000000326269', action: 'assign_production_barcode',
        article: 'GRA-00180', barcode: '2000000326269', label: 'Оставить текущий код',
        detail: 'Сейчас установлен производственным в GRAскладе',
      },
      {
        id: 'kb-2000000326481', action: 'assign_production_barcode',
        article: 'GRA-00180', barcode: '2000000326481', label: 'Взять код базы знаний',
        detail: 'Указан на этикетке в базе знаний',
      },
    ],
    evidence: [
      { source: 'История сканов', tone: 'support', text: '2000000326269 — 1 293 скана; 2000000326481 — 144 скана.' },
      { source: 'GRAсклад', tone: 'neutral', text: 'Текущий производственный код — 2000000326269.' },
      { source: 'База знаний', tone: 'warning', text: 'В этикетке указан другой код — 2000000326481.' },
    ],
  },
  {
    issueKey: 'barcode:400000000299',
    issueType: 'barcode_owner',
    severity: 'critical',
    primaryBarcode: '400000000299',
    title: 'Исторический код назначен новой карточке',
    description: 'Код имеет большую историю сканов у архивной карточки, сейчас стоит у GRA-04730, а база знаний связывает его с отсутствующей в WMS карточкой GRA-04600.',
    recommendedOptionId: 'owner-gra-04600',
    options: [
      {
        id: 'owner-gra-04600', action: 'assign_production_barcode',
        article: 'GRA-04600', barcode: '400000000299', label: 'GRA-04600',
        detail: 'Карточки пока нет в GRAскладе; вариант из базы знаний',
      },
      {
        id: 'owner-gra-04730', action: 'assign_production_barcode',
        article: 'GRA-04730', barcode: '400000000299', label: 'GRA-04730',
        detail: 'Текущий владелец в GRAскладе',
      },
      {
        id: 'owner-legacy-85', action: 'assign_production_barcode',
        product_id: 85, article: 'GRA-04', barcode: '400000000299', label: 'Архивная GRA-04',
        detail: 'Историческая карточка «удалить»',
      },
    ],
    evidence: [
      { source: 'История сканов', tone: 'warning', text: 'Архивная карточка #85 — 44 678 сканов; GRA-04730 — 39 сканов.' },
      { source: 'База знаний', tone: 'support', text: 'Код 400000000299 указан у GRA-04600.' },
      { source: 'Каталог WMS', tone: 'warning', text: 'GRA-04600 отсутствует, поэтому выбор можно записать, но применить только после создания карточки.' },
    ],
  },
  {
    issueKey: 'barcode:2000000326306',
    issueType: 'barcode_owner',
    severity: 'critical',
    primaryBarcode: '2000000326306',
    title: 'Код набора конфликтует с этикеткой отдельного товара',
    description: 'В GRAскладе код принадлежит набору GRA-04740, а в базе знаний он указан для GRA-04730.',
    recommendedOptionId: null,
    options: [
      {
        id: 'owner-gra-04740', action: 'assign_production_barcode',
        article: 'GRA-04740', barcode: '2000000326306', label: 'GRA-04740',
        detail: 'Набор магния из трёх банок; текущий владелец',
      },
      {
        id: 'owner-gra-04730', action: 'assign_production_barcode',
        article: 'GRA-04730', barcode: '2000000326306', label: 'GRA-04730',
        detail: 'Магний Цитрат + D3; вариант базы знаний',
      },
    ],
    evidence: [
      { source: 'История сканов', tone: 'support', text: 'У GRA-04740 зафиксировано 1 205 сканов этого кода.' },
      { source: 'База знаний', tone: 'warning', text: 'Этикетка связывает 2000000326306 с GRA-04730.' },
      { source: 'GRAсклад', tone: 'neutral', text: 'Сейчас код является производственным у GRA-04740.' },
    ],
  },
  {
    issueKey: 'production:GRA-00110',
    issueType: 'production_barcode',
    severity: 'medium',
    subjectArticle: 'GRA-00110',
    primaryBarcode: '2000000326429',
    title: 'Подтвердить найденный производственный код',
    description: 'Код есть среди дополнительных и подтверждён этикеткой и сканами, но поле производственного штрихкода пустое.',
    recommendedOptionId: 'assign-2000000326429',
    options: [
      {
        id: 'assign-2000000326429', action: 'assign_production_barcode',
        article: 'GRA-00110', barcode: '2000000326429', label: 'Назначить 2000000326429',
        detail: 'Сделать код производственным для GRA-00110',
      },
      {
        id: 'keep-gra-00110', action: 'keep_no_change',
        article: 'GRA-00110', label: 'Оставить без производственного кода',
        detail: 'Только записать решение, карточку не менять',
      },
    ],
    evidence: [
      { source: 'История сканов', tone: 'support', text: 'Код успешно использован 1 018 раз.' },
      { source: 'База знаний', tone: 'support', text: 'Этикетка подтверждает код 2000000326429.' },
    ],
  },
  {
    issueKey: 'status:GRA-08082',
    issueType: 'product_status',
    severity: 'medium',
    subjectArticle: 'GRA-08082',
    title: 'Карточка без этикетки и складской истории',
    description: 'У товара нет производственного кода, остатков, размещений, сканов и движений; в Ozon обнаружена цепочка архивных дублей.',
    recommendedOptionId: 'archive-gra-08082',
    options: [
      {
        id: 'archive-gra-08082', action: 'archive_product',
        article: 'GRA-08082', label: 'Архивировать карточку',
        detail: 'Скрыть из рабочего каталога, сохранив строку и историю',
      },
      {
        id: 'keep-gra-08082', action: 'keep_no_change',
        article: 'GRA-08082', label: 'Оставить активной',
        detail: 'Зафиксировать решение без изменения карточки',
      },
    ],
    evidence: [
      { source: 'GRAсклад', tone: 'support', text: 'Остаток 0, размещений 0, движений 0, сканов 0.' },
      { source: 'База знаний', tone: 'warning', text: 'Этикетка GRA-08082 не найдена.' },
      { source: 'Ozon', tone: 'warning', text: 'Найдены архивные GRA-08082, GRA-08082_1 и последующие пересоздания без GTIN.' },
    ],
  },
];

module.exports = { KNOWN_BARCODE_DISPUTES };
