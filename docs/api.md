# API Reference

Base URL: http://localhost:3000 (или https://<domain>/recorder-api через nginx)

## POST /recordings

Начать запись комнаты. Тело запроса:

    {"room": "my-meeting", "displayName": "Recorder Bot"}

Ответы: 200 started, 409 уже пишется, 400 нет room.

## POST /recordings/:room/stop

Остановить запись. Ответ содержит downloadUrl (подписанный, TTL 15 мин).

## GET /recordings

    {"active": ["room1", "room2"]}

## GET /files

Список всех файлов записей.

## GET /files/:room

Файлы конкретной комнаты.

## GET /sign/:filename

Сгенерировать подписанную ссылку:

    {"downloadUrl": "/download/...?token=...&expires=..."}

## GET /download/:filename?token=...&expires=...

Скачивание файла. Без валидной подписи — 401.

## GET /health

    {"ok": true}

## Авторизация (опционально)

Если задан API_TOKEN в .env — все запросы требуют заголовок:

    Authorization: Bearer <token>
