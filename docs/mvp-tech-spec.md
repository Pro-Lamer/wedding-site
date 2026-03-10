# Техническое ТЗ на разработку сервиса (MVP)

## 0) Рамки MVP

### В MVP реализуем

- Регистрация компании по ИНН + подтягивание реквизитов из ЕГРЮЛ через провайдера данных.
- Профиль компании + уровни верификации.
- Посты двух типов: **Заявка** и **Предложение**.
- Отклики на посты + тред сообщений (без полноценного чата).
- Поиск по постам и компаниям (фильтры).
- Платный unlock контактов через подписку/разовую оплату.
- Мини-админка для модерации/жалоб.
- Аналитика событий (event tracking).

### Не делаем в MVP

- ЕСИА / Госуслуги логин.
- Рекомендательную систему (ML).
- Карту/георадиусы.
- Интеграции с CRM.
- Сложную репутацию/скоринг.

## 1) Архитектура и стек

### 1.1. Компоненты

#### Frontend Web/PWA

- React + TypeScript + Tailwind.
- PWA: service worker, офлайн-кеш статических ассетов, установка на мобильные.

#### Backend API

- Node.js (NestJS/Fastify) **или** Go (Gin/Fiber).
- REST API + OpenAPI/Swagger.
- Сервисы: авторизация, бизнес-логика, модерация, платежи, интеграции.

#### DB

- PostgreSQL (основная реляционная БД).
- Миграции через ORM или SQL-migrations.

#### Cache / Rate limit

- Redis для rate limiting, сессий, кешей.

#### Object Storage

- S3-совместимое хранилище (например, MinIO) для логотипов/вложений.
- Проверка upload по типам и размеру; опционально антивирус-скан.

#### Observability

- Логи JSON, метрики Prometheus, трассировка OpenTelemetry, алерты.

### 1.2. Среды

- `dev` (локально), `staging` (предпрод), `prod` (прод).
- Развёртывание: Docker + docker-compose для MVP; Kubernetes — позже.

## 2) Авторизация и роли

### 2.1. Модель аккаунта

- 1 аккаунт = 1 компания.
- Внутри компании минимум 1 пользователь: Company Admin.
- Пользователи привязаны к компании.

### 2.2. Auth

- Email + password + подтверждение email (verification link).
- JWT access + refresh.
- Refresh-сессии: хранить хэш в БД/Redis, поддержать logout и ротацию токенов.

### 2.3. RBAC

- `company_admin`: управление профилем, постами, откликами, покупка тарифа.
- `company_member` (опционально в MVP): создание/ответы на отклики.
- `moderator/admin`: модерация, блокировки, обработка жалоб.

## 3) Интеграция с ЕГРЮЛ (провайдер данных)

### 3.1. Требование

По ИНН подтягивать:

`full_name, short_name, ogrn, inn, kpp, status, reg_date, legal_address, okved_main, okved_additional`

Важно реализовать **provider adapter**, чтобы можно было сменить источник без переписывания бизнес-логики.

### 3.2. Хранение

- Сохранять снимок ЕГРЮЛ в `company_registry_snapshot`.
- Поля: `registry_last_checked_at`, `registry_source`.

### 3.3. Обновление

- Ручной сценарий «обновить реквизиты» (лимит: не чаще 1 раза в 24 часа).
- Фоновая cron-задача — опционально в MVP.

## 4) Модель данных (PostgreSQL)

> Формат: сущность → ключевые поля (без мелочей). Типы и точные ограничения согласовать при реализации.

### 4.1. Companies

#### `companies`

- `id` (UUID)
- `inn` (строка, unique)
- `ogrn`, `kpp`
- `name_full`, `name_short`
- `status` (enum)
- `legal_address`
- `okved_main`, `okved_list` (jsonb)
- `description`, `website`
- `region_code` (ФИАС/ОКАТО/условный справочник — выбрать один)
- `verification_level` (enum: `L1_registry`, `L2_email_verified`, `L3_manual`)
- `contacts_email`, `contacts_phone` (nullable; показывать по unlock/pro)
- `created_at`, `updated_at`

#### `company_registry_snapshot`

- `id`, `company_id` (FK)
- `payload` (jsonb)
- `source`, `checked_at`

### 4.2. Users

#### `users`

- `id` (UUID)
- `company_id` (FK)
- `email` (unique)
- `password_hash`
- `role` (enum)
- `email_verified_at`
- `last_login_at`
- `created_at`

### 4.3. Posts

#### `posts`

- `id` (UUID)
- `company_id` (FK)
- `type` (enum: `request`, `offer`)
- `title`
- `description`
- `category_id` (FK)
- `budget_min`, `budget_max` (nullable; для offer можно иначе)
- `currency` (RUB фикс в MVP)
- `region_code` / `remote_flag`
- `deadline_date` (nullable)
- `status` (enum: `active`, `hidden`, `archived`)
- `created_at`, `updated_at`

#### `categories`

- `id`, `name`, `parent_id` (опционально)

### 4.4. Responses и тред

#### `responses`

- `id`
- `post_id` (FK)
- `company_id` (FK) — кто откликнулся
- `price` (nullable)
- `timeline_days` (nullable)
- `message` (text)
- `attachments` (jsonb pointers)
- `status` (enum: `sent`, `viewed`, `replied`, `withdrawn`)
- `created_at`

#### `response_messages`

- `id`
- `response_id` (FK)
- `author_company_id` (FK)
- `body`
- `created_at`

### 4.5. Contact unlock / тарифы / платежи

#### `contact_unlocks`

- `id`
- `requester_company_id` (FK)
- `target_company_id` (FK)
- `context_type` (enum: `company`, `post`)
- `context_id` (UUID nullable)
- `unlock_type` (enum: `subscription`, `one_time`)
- `created_at`
- `expires_at` (nullable)

#### `subscriptions`

- `id`
- `company_id` (FK)
- `plan` (enum: `free`, `pro`)
- `status` (enum: `active`, `canceled`, `past_due`)
- `started_at`, `ends_at`

#### `payments`

- `id`
- `company_id`
- `provider` (enum)
- `provider_payment_id`
- `amount`
- `currency`
- `status` (enum: `created`, `paid`, `failed`, `refunded`)
- `created_at`

### 4.6. Reviews (упрощённо)

#### `reviews`

- `id`
- `from_company_id` (FK)
- `to_company_id` (FK)
- `contact_unlock_id` (FK) — основание
- `rating_quality`, `rating_timing`, `rating_communication` (1..5)
- `text`
- `status` (enum: `pending`, `published`, `rejected`)
- `created_at`, `published_at`

### 4.7. Moderation / reports / audit

#### `reports`

- `id`
- `reporter_company_id`
- `target_type` (enum: `company`, `post`, `response`, `review`)
- `target_id`
- `reason` (enum)
- `comment`
- `status` (enum: `new`, `in_progress`, `resolved`)
- `created_at`

#### `moderation_actions`

- `id`
- `moderator_user_id`
- `action_type` (`hide_post`, `block_company`, `reject_review`, ...)
- `target_type`, `target_id`
- `reason`
- `created_at`

#### `audit_log`

- `id`
- `actor_user_id`
- `action`
- `object_type`, `object_id`
- `meta` (jsonb)
- `created_at`

### 4.8. Индексы (минимум)

- `companies`: `unique(inn)`, `index(region_code)`, `index(verification_level)`
- `posts`: `index(type, status)`, `index(category_id)`, `index(region_code)`, `index(created_at)`
- `responses`: `index(post_id)`, `index(company_id)`, `unique(post_id, company_id)`
- `contact_unlocks`: `index(requester_company_id, created_at)`, `index(target_company_id)`

### 4.9. Поиск (FTS)

PostgreSQL Full-Text Search:

- `companies.name`, `companies.description`, `posts.title`, `posts.description`.
- Отдельные `tsvector` + `GIN` индексы.

## 5) API контракты (REST, `/api/v1`)

### 5.1. Auth

- `POST /auth/register` (email, password, inn) → create user + company draft
- `POST /auth/login` → tokens
- `POST /auth/refresh`
- `POST /auth/logout`
- `POST /auth/verify-email` (token)

### 5.2. Company

- `POST /companies/verify-inn` (inn) → registry preview
- `GET /companies/me`
- `PATCH /companies/me` (описание, сайт, регионы, контакты)
- `POST /companies/me/logo` (upload)
- `GET /companies/{id}` (публичная карточка; контакты скрыть если нет unlock/pro)
- `POST /companies/{id}/unlock` (оплата/проверка тарифа) → создаёт `contact_unlock`

### 5.3. Posts

- `POST /posts`
- `GET /posts` (filters: type, category, region, budget_min, status, q, sort)
- `GET /posts/{id}`
- `PATCH /posts/{id}`
- `POST /posts/{id}/hide`
- `POST /posts/{id}/archive`

### 5.4. Responses

- `POST /posts/{id}/responses`
- `GET /posts/{id}/responses` (только автор поста)
- `POST /responses/{id}/messages` (тред)
- `GET /responses/{id}` (участники треда)

### 5.5. Reviews

- `POST /reviews` (to_company_id, contact_unlock_id, ratings, text)
- `GET /companies/{id}/reviews`
- `PATCH /admin/reviews/{id}` (status)

### 5.6. Reports/Admin

- `POST /reports`
- `GET /admin/reports`
- `PATCH /admin/reports/{id}`
- `POST /admin/actions` (hide/block/reject)

> Требование: все эндпоинты описаны в OpenAPI и поддерживаются в актуальном состоянии.

## 6) Платежи (provider-agnostic)

### 6.1. Провайдер

Поддержать минимум 1 платёжный провайдер РФ через интерфейс `PaymentProvider`.

### 6.2. Сценарии

- Купить Pro (подписка): создание платежа → редирект/виджет → webhook paid → активировать subscription.
- Разовый unlock контакта: payment → webhook paid → создать contact_unlock.

### 6.3. Webhooks

`POST /webhooks/payments/{provider}`:

- Проверка подписи.
- Идемпотентность (уникальный `provider_event_id`).
- Логирование.

## 7) Антиспам и безопасность

### 7.1. Rate limiting

Redis-лимиты:

- регистрация/логин per IP,
- создание постов/откликов per company,
- unlock/платежные операции (строже).

### 7.2. Контент-контроль

- max длина описаний,
- max вложений и размер файла,
- запрещённые типы файлов,
- репорты + ручная модерация первых действий (например, первые 3 поста компании).

### 7.3. Защита контактов

Контакты выдаются только при:

- активной подписке Pro или
- существующем contact_unlock между requester и target.

Все раскрытия контактов логируются в `audit_log`.

### 7.4. ПДн и локализация

Любые контакты физлиц (email/телефон) трактуются как ПДн:

- хранение в РФ-инфраструктуре,
- минимизация хранения,
- шифрование секретов (KMS/ENV) и ограничение доступа (RBAC).

### 7.5. OWASP базис

Защита от XSS/CSRF/SQLi, CORS-политика, secure headers.

## 8) Производительность и SLA

- Поиск: `p95 < 1000 ms` при `10k` компаний / `50k` постов.
- Лента: cursor pagination вместо offset.
- Кеширование:
  - карточки компаний/постов (TTL 30–120 сек),
  - справочники категорий.

## 9) Логи, метрики, мониторинг

- Логи: structured JSON + correlation id.
- Метрики: RPS, latency, error rate, DB pool usage, Redis usage.
- Трейсинг: OTel для API → DB → внешние вызовы (ЕГРЮЛ, платежи).

## 10) CI/CD и качество

### CI

- линтер, форматтер, тесты, сборка контейнеров.

### CD

- деплой в staging по merge, в prod по tag/release.

### Тесты

- unit на бизнес-логику,
- integration на API + БД,
- contract tests для webhooks платежей.

### Definition of Done

- миграции есть,
- OpenAPI обновлён,
- события аналитики задокументированы,
- основные сценарии покрыты тестами,
- алерты/логирование включены.
