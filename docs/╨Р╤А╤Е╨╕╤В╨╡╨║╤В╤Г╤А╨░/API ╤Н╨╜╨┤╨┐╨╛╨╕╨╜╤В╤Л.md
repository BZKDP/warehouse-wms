# API эндпоинты

Все роуты под префиксом `/api/`. Авторизация через JWT Bearer token.

Базовый health check: `GET /api/health` → `{ ok: true }`

## Auth (`/api/auth`) — `backend/src/routes/auth.js`
| Метод | Путь | Доступ | Описание |
|---|---|---|---|
| POST | /login | public (rate limit 15/мин) | Логин (username + password) → token + user |
| GET | /me | auth | Текущий пользователь с ролью и правами |
| POST | /change-password | auth | Смена пароля (current + new) |

## Products (`/api/products`) — `backend/src/routes/products.js`
| Метод | Путь | Доступ | Описание |
|---|---|---|---|
| GET | / | auth | Список товаров (поиск, фильтры, пагинация) |
| GET | /stats | auth | Статистика каталога (кол-во, бандлы, архивные) |
| GET | /:id | auth | Детали товара с компонентами бандла |
| POST | / | admin | Создать товар |
| PUT | /:id | admin | Обновить товар |
| DELETE | /:id | admin | Удалить товар |
| POST | /:id/components | admin | Добавить компонент в бандл |
| PUT | /:id/components/:compId | admin | Обновить компонент бандла |
| DELETE | /:id/components/:compId | admin | Удалить компонент бандла |
| GET | /barcode/:value | auth | Найти товар по штрихкоду |
| GET | /wb-stores | admin | Список настроенных WB-магазинов |
| POST | /check-wb | admin | Проверка штрихкодов на Wildberries (по магазину) |
| POST | /check-wb-all | admin | Проверка всех товаров на Wildberries |
| GET | /ozon-stores | admin | Список настроенных магазинов OZON |
| POST | /check-ozon | admin | Проверка штрихкодов на OZON (по магазину) |
| POST | /check-ozon-all | admin | Проверка всех товаров на OZON |
| PUT | /:id/barcode-type | admin | Изменить тип штрихкода |
| POST | /:id/barcode | admin | Добавить штрихкод |
| DELETE | /:id/barcode | admin | Удалить штрихкод |
| POST | /sync | admin | Синхронизация каталога из МойСклад |
| GET | /import/history | admin | История импорта (последние 10) |

## Materials (`/api/materials`) — `backend/src/routes/materials.js`
| Метод | Путь | Доступ | Описание |
|---|---|---|---|
| GET | / | auth | Список сырья (фильтры по category, material_group, поиск) |
| GET | /stats | auth | Статистика по категориям |
| GET | /:id | auth | Детали материала с рецептами и техкартами |
| POST | / | admin | Создать материал |
| PUT | /:id | admin | Обновить материал |
| DELETE | /:id | admin | Удалить материал |
| POST | /:id/recipe | admin | Добавить ингредиент в рецепт |
| DELETE | /:id/recipe/:recipeId | admin | Удалить ингредиент из рецепта |

## Стеллажный склад (`/api/warehouse`) — `backend/src/routes/warehouse.js`
| Метод | Путь | Доступ | Описание |
|---|---|---|---|
| GET | /warehouses | auth | Список складов (со счётчиками) |
| GET | /warehouses/:id | auth | Склад со стеллажами и полками |
| POST | /warehouses | admin | Создать склад |
| PUT | /warehouses/:id | admin | Обновить склад |
| GET | /warehouses/:id/delete-impact | warehouse.edit | Остаток и структура, которые будут удалены |
| DELETE | /warehouses/:id | warehouse.edit | Удалить склад; при наличии остатка требуется `?force=true` |
| GET | /racks | auth | Список стеллажей (фильтр по warehouse_id) |
| GET | /racks/:id | auth | Стеллаж с полками и содержимым |
| POST | /racks | admin | Создать стеллаж |
| PUT | /racks/:id | admin | Обновить стеллаж |
| DELETE | /racks/:id | admin | Удалить стеллаж |
| GET | /shelves/barcode/:value | auth | Полка по штрихкоду |
| GET | /shelves/:id | auth | Детали полки с товарами и коробками |
| POST | /shelves | admin | Создать полку |
| PUT | /shelves/:id | admin | Обновить полку |
| DELETE | /shelves/:id | admin | Удалить полку |
| POST | /shelves/:id/set | auth | Установить содержимое полки (inventory) |
| GET | /shelf-boxes/:id | auth | Детали коробки на полке |
| POST | /shelves/:id/box | admin | Создать коробку на полке |
| PUT | /shelf-boxes/:id | admin | Обновить коробку на полке |
| DELETE | /shelf-boxes/:id | admin | Удалить коробку с полки |
| GET | /stats | auth | Статистика склада |
| GET | /movements | auth | История движений (shelf_movements_s) |
| GET | /visual/:warehouseId | auth | Визуальный склад (для visual warehouse) |
| GET | /visual-fbs/:warehouseId | auth | Визуальный стеллажный склад |
| POST | /visual-fbs/move | auth | Перемещение в визуальном стеллажном складе |

## Паллетный склад (`/api/fbo`) — `backend/src/routes/fbo.js`
| Метод | Путь | Доступ | Описание |
|---|---|---|---|
| GET | /warehouses | auth | Список FBO складов |
| POST | /warehouses | admin/manager | Создать FBO склад |
| GET | /warehouses/:id/delete-impact | warehouse.edit | Остаток и структура, которые будут удалены |
| DELETE | /warehouses/:id | warehouse.edit | Удалить паллетный склад; при наличии остатка требуется `?force=true` |
| GET | /warehouses/:id | auth | Склад с рядами и статистикой |
| POST | /rows | admin/manager | Создать ряд |
| PUT | /rows/:id | admin/manager | Обновить ряд |
| DELETE | /rows/:id | admin/manager | Удалить ряд |
| GET | /rows/:id | auth | Ряд с паллетами и статистикой |
| POST | /pallets | admin/manager | Создать паллет |
| DELETE | /pallets/:id | admin/manager | Удалить паллет |
| GET | /pallets/:id | auth | Паллет с коробками и россыпью |
| POST | /pallets/:id/box | admin/manager | Добавить коробку на паллет |
| POST | /pallets/:id/item | admin/manager | Добавить товар россыпью на паллет |
| PUT | /pallets/:palletId/item/:productId | admin/manager | Обновить кол-во россыпи |
| GET | /boxes/:id | auth | Детали коробки с товарами |
| PUT | /boxes/:id | admin/manager | Обновить коробку |
| DELETE | /boxes/:id | admin/manager | Удалить коробку |
| GET | /pallets-list | auth | Плоский список паллетов (для выбора) |
| POST | /visual/move | auth | Перемещение коробки между паллетами |
| GET | /visual/:warehouseId | auth | Визуальный паллетный склад |
| GET | /box-warehouse/:warehouseId/boxes | auth | Список коробок в складе типа «box» |
| POST | /box-warehouse/:warehouseId/boxes | admin/manager | Создать коробку в складе типа «box» |
| PUT | /box-warehouse/boxes/:id | admin/manager | Обновить коробку |
| DELETE | /box-warehouse/boxes/:id | admin/manager | Удалить коробку |

## Tasks (`/api/tasks`) — `backend/src/routes/tasks.js`
| Метод | Путь | Доступ | Описание |
|---|---|---|---|
| GET | / | auth | Список задач (фильтры по status, task_type, employee_id) |
| GET | /stats/summary | admin | Сводка статистики задач |
| GET | /analytics/summary | admin | Аналитика по задачам |
| GET | /analytics/inventory-overview | admin | Обзор инвентаризации |
| GET | /analytics/inventory-history | admin | История инвентаризации |
| GET | /analytics/audit-report | admin | Аудит-отчёт |
| GET | /analytics/table-report | admin | Табличный отчёт (дерево: склад→стеллаж→полка) |
| GET | /errors | admin | Ошибки сканирования |
| PUT | /errors/:id/resolve | admin | Разрешить ошибку |
| GET | /busy-targets | admin/manager | Занятые цели (полки/паллеты с активными задачами) |
| GET | /:id | auth | Детали задачи |
| GET | /:id/analytics | auth | Аналитика конкретной задачи |
| POST | / | admin/manager | Создать задачу |
| POST | /:id/next-shelf | auth | Перейти к следующей полке (мульти-полка) |
| PUT | /:id | admin/manager | Обновить задачу |
| DELETE | /:id | admin/manager | Удалить задачу |
| POST | /:id/start | auth | Начать выполнение |
| POST | /:id/scan | auth | Записать сканирование |
| POST | /:id/report-error | auth | Сообщить об ошибке сканирования |
| POST | /:id/abandon-box | auth | Бросить коробку |
| POST | /:id/complete | auth | Завершить задачу |

## Packing (`/api/packing`) — `backend/src/routes/packing.js`
| Метод | Путь | Доступ | Описание |
|---|---|---|---|
| GET | /:taskId | auth | Состояние задачи упаковки |
| POST | /:taskId/start | auth | Начать упаковку |
| POST | /:taskId/open-box | auth | Открыть коробку |
| POST | /:taskId/confirm-box | auth | Подтвердить коробку |
| POST | /:taskId/scan | auth | Сканировать товар в коробку |
| POST | /:taskId/close-box | auth | Закрыть коробку |
| POST | /:taskId/close-remainder | auth | Закрыть остаток |
| POST | /:taskId/complete | auth | Завершить упаковку |
| GET | /:taskId/remainder-shelf | auth | Полка для остатков |
| GET | /:taskId/boxes | auth | Коробки задачи |
| POST | /:taskId/cancel-box | auth | Отменить коробку |

## Movements (`/api/movements`) — `backend/src/routes/movements.js`
| Метод | Путь | Доступ | Описание |
|---|---|---|---|
| POST | /scan | auth | Распознать штрихкод (паллет/полка/коробка/товар) |
| POST | /move | auth | Универсальное перемещение товара |
| GET | /history | auth | История перемещений (пагинация, фильтры; `category` = категория аналитики) |
| GET | /stats | auth | Статистика перемещений |
| GET | /analytics/meta | movements.view | Справочник категорий и каналов для фильтров |
| GET | /analytics/summary | movements.view | Что и сколько ушло за период, по товарам (+ разрез WB/Ozon) |
| GET | /analytics/daily | movements.view | Те же цифры по дням |
| GET | /analytics/employees | movements.view | Сотрудники, двигавшие товар в периоде |
| GET | /analytics/product/:id | movements.view | Детализация товара: по дням и по сотрудникам |
| GET | /employee-inventory/:employeeId | auth | Инвентарь сотрудника |
| GET | /my-inventory | auth | Мой инвентарь (текущий пользователь) |
| GET | /all-employee-inventory | admin | Инвентарь всех сотрудников |
| PUT | /employee-inventory/:employeeId/:productId | admin | Обновить количество в инвентаре |
| DELETE | /employee-inventory/:employeeId/:productId | admin | Удалить из инвентаря |
| POST | /employee-inventory/:employeeId | admin | Добавить в инвентарь сотрудника |

## Staff (`/api/staff`) — `backend/src/routes/staff.js`
| Метод | Путь | Доступ | Описание |
|---|---|---|---|
| GET | /employees | admin | Список сотрудников |
| GET | /external-employees | admin | Сотрудники из внешней БД (для привязки) |
| POST | /employees | admin | Создать сотрудника (+ опционально учётную запись) |
| GET | /employees/:id/credentials | admin | Учётные данные сотрудника |
| PUT | /employees/:id | admin | Обновить сотрудника |
| DELETE | /employees/:id | admin | Удалить сотрудника |
| GET | /roles | auth | Список ролей с правами |
| POST | /roles | admin | Создать роль |
| PUT | /roles/:id | admin | Обновить роль (имя, права) |
| DELETE | /roles/:id | admin | Удалить роль |
| GET | /users | admin | Список пользователей |
| POST | /users | admin | Создать учётную запись |
| PUT | /users/:id | admin | Обновить пользователя |
| DELETE | /users/:id | admin | Удалить пользователя |

## Earnings (`/api/earnings`) — `backend/src/routes/earnings.js`
| Метод | Путь | Доступ | Описание |
|---|---|---|---|
| GET | /summary | admin | Сводка начислений (общий баланс, за сегодня/неделю) |
| GET | /employees | admin | Список заработков всех сотрудников |
| GET | /employees/:employeeId | admin | Детали заработка сотрудника (с пагинацией) |
| GET | /tasks/:taskId | admin | Заработок по задаче |
| POST | /employees/:employeeId/set-balance | admin | Установить баланс GRACoin |

## Errors (`/api/errors`) — `backend/src/routes/syserrors.js`
| Метод | Путь | Доступ | Описание |
|---|---|---|---|
| POST | /system | public (rate limit 30/мин) | Логировать ошибку фронтенда |
| GET | /system | admin | Список ошибок |
| DELETE | /system/:id | admin | Удалить запись ошибки |
| DELETE | /system | admin | Очистить все ошибки |

## Assembly (`/api/assembly`) — `backend/src/routes/assembly.js`
| Метод | Путь | Доступ | Описание |
|---|---|---|---|
| GET | /source-locations | auth | Где хранятся компоненты бандла |
| POST | / | admin | Создать задачу сборки комплекта |
| GET | /:id | auth | Детали задачи сборки |
| GET | /:id/source-boxes | auth | Коробки-источники для забора |
| POST | /:id/start-picking | auth | Начать фазу забора |
| POST | /:id/scan-pick | auth | Сканировать товар при заборе |
| POST | /:id/start-assembling | auth | Начать фазу сборки |
| POST | /:id/scan-component | auth | Сканировать компонент в комплект |
| POST | /:id/confirm-bundle | auth | Подтвердить собранный комплект (скан ШК) |
| POST | /:id/start-placing | auth | Начать фазу размещения |
| POST | /:id/scan-place | auth | Сканировать комплект при размещении |
| POST | /:id/complete | auth | Завершить задачу сборки |
| DELETE | /:id | admin | Удалить задачу (откат перемещений) |

## Feedback (`/api/feedback`) — `backend/src/routes/feedback.js`
| Метод | Путь | Доступ | Описание |
|---|---|---|---|
| POST | / | auth | Создать обратную связь (с файлами) |
| GET | / | admin | Список фидбэка |
| GET | /:id | admin | Детали фидбэка |
| PATCH | /:id | admin | Обновить статус/заметки |
| DELETE | /:id | admin | Удалить фидбэк |

## Settings (`/api/settings`) — `backend/src/routes/settings.js`
| Метод | Путь | Доступ | Описание |
|---|---|---|---|
| GET | / | auth | Получить все настройки |
| PUT | / | admin | Обновить настройки (UPSERT по ключам) |
