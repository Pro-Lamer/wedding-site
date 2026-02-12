# Wedding B2B MVP (готовый запускаемый прототип)

Проект реализует рабочий MVP по вашему ТЗ:
- backend API (Fastify + PostgreSQL),
- frontend визуальный интерфейс (React + Vite),
- инфраструктура (PostgreSQL + Redis + MinIO через docker-compose),
- миграции, OpenAPI и аналитические события.

## Что уже работает

### Backend
- Регистрация и логин компании (`/api/v1/auth/register`, `/api/v1/auth/login`, `/api/v1/auth/refresh`).
- Профиль компании (`GET/PATCH /api/v1/companies/me`).
- Посты (`POST /api/v1/posts`, `GET /api/v1/posts`).
- Отклики (`POST /api/v1/posts/{id}/responses`, `GET /api/v1/my/responses`).
- Жалобы (`POST /api/v1/reports`).
- Stub для проверки ИНН через провайдера (`POST /api/v1/companies/verify-inn`).
- Stub для unlock контактов / платежей (`POST /api/v1/companies/{id}/unlock`).

### Frontend (визуал)
- Форма регистрации/входа.
- Просмотр профиля компании.
- Создание постов и список постов.
- Отправка тестового отклика.
- Просмотр собственных откликов.

## Быстрый старт

### 1) Поднять инфраструктуру

```bash
docker compose up -d
```

### 2) Установить зависимости

```bash
npm run install:all
```

### 3) Настроить backend env

```bash
cp backend/.env.example backend/.env
```

### 4) Запустить backend

```bash
npm run dev:backend
```

### 5) Запустить frontend

```bash
npm run dev:frontend
```

### 6) Открыть приложение

- http://localhost:5173

## Файлы проекта

- `db/migrations/001_init.sql` — основная схема БД.
- `db/migrations/002_seed_categories.sql` — стартовые категории.
- `openapi/openapi.yaml` — контракт API.
- `docs/analytics-events.md` — список событий аналитики.
- `backend/src/server.js` — API сервера.
- `frontend/src/App.jsx` — UI демо-панель.

## Что оставлено заглушками (нужно ваше вмешательство)

1. **ЕГРЮЛ-провайдер**: сейчас `verify-inn` возвращает stub-ответ.
2. **Платежный провайдер**: unlock контактов возвращает stub.
3. **Почтовая верификация**: endpoint в контракте есть, но не подключен SMTP.
4. **Продвинутая модерация/админка**: в API контракте описана, в коде пока базовые сценарии.

## Следующий этап

Готов продолжать сразу в следующем шаге:
- подключить реального провайдера ЕГРЮЛ и платежку,
- добавить полноценную админку и роли moderator/admin,
- довести до production-ready деплоя (CI/CD, observability, contract tests).
