# Daily CIAN parser + history pipeline

Скрипт `scripts/daily_ads_pipeline.py` теперь делает **полный цикл**:

1. Парсит CIAN по нашему CSV адресов (время до метро ±2 минуты и та же станция).
2. Сохраняет ежедневную сырую выгрузку (опционально).
3. Обновляет историю `(ad_id, parse_date)`.
4. Обновляет master-таблицу по объявлениям.
5. Формирует итоговый файл с полями как в ТЗ.

## Формат CSV адресов

Ожидаемые колонки (поддерживаются алиасы):

- `name` / `Наша квартира`
- `time` / `time_station` / `time_to_metro`
- `metro_station` / `metro` / `station`

Пример:

```csv
name,time,metro_station
1. Ленинградский проспект, 78/1, кв 8,42,116
```

## Запуск (с парсингом CIAN)

```bash
python3 scripts/daily_ads_pipeline.py \
  --addresses-csv data/directory_search_2026-02-25.csv \
  --parsed-daily-csv data/daily_raw_2026-02-25.csv \
  --history-csv data/history.csv \
  --master-csv data/master.csv \
  --output-csv data/final_2026-02-25.csv \
  --parse-date 2026-02-25 \
  --region 1 \
  --pages 3
```

## Запуск (если daily CSV уже собран)

```bash
python3 scripts/daily_ads_pipeline.py \
  --daily-csv data/daily_raw_2026-02-25.csv \
  --history-csv data/history.csv \
  --master-csv data/master.csv \
  --output-csv data/final_2026-02-25.csv \
  --parse-date 2026-02-25
```

## Логика срока жизни

- Новое объявление в день первого появления: `0`.
- Если объявление было вчера и есть сегодня: `+1`.
- Если объявления нет в сегодняшней выгрузке: `0` в master-таблице.

## Формат итоговой таблицы

`Наша квартира, ID, Ссылка, Адрес, Дата создания, Дата первого парсинга, Цена, Срок жизни, дни`.
