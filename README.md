# 🎙 Jitsi Audio Recorder

**Headless audio recorder for Jitsi Meet** — записывает аудио встреч без браузера, используя WebRTC напрямую.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## ✨ Возможности

- 🚀 **Без браузера** — работает как headless Node.js сервис
- 🎯 **REST API** — управление записями через HTTP
- 🎨 **Интеграция в UI** — кнопка в меню Jitsi (⋯)
- 🤖 **Автостоп** — запись останавливается когда все вышли
- 📦 **Лёгкий формат** — WebM/Opus (~14 MB/час моно)
- 🔀 **Параллельные записи** — поддержка нескольких комнат одновременно
- 🛡 **Защита от дублей** — нельзя призвать двух ботов
- 📅 **Читаемые имена** — `room-2026-09-24_18-05-33.webm`
- 🔒 **Подписанные URL** — безопасная раздача файлов (15 мин TTL)
- 🎤 **Fireflies AI** — автоматическая транскрипция и AI-анализ

## 🏗 Архитектура
```bash
Browser (Jitsi UI)
│ WebRTC audio
▼
Jitsi Videobridge (JVB)
│ WebRTC (receive-only)
▼
audio-recorder (Node.js + @roamhq/wrtc)
│ PCM 48kHz mono
▼
AudioMixer → ffmpeg (libopus) → .webm file
│
▼
Подписанный URL (15 мин) → Fireflies API → Транскрипция
```

## 🚀 Быстрый старт

### Требования

- Jitsi Meet (Docker или standalone)
- Docker & Docker Compose (для Docker-установки)
- Node.js 20+ (для standalone)
- ffmpeg

### Установка

```bash
git clone https://github.com/MaxSad-first/jitsi-audio-recorder.git
cd jitsi-audio-recorder
chmod +x install.sh
sudo ./install.sh
```

### Установщик:
- Проверит зависимости
- Спросит тип установки (Docker/standalone)
- **Автоматически определит реальный внутренний XMPP-домен и docker-сеть** prosody, не полагаясь на введённый публичный домен (для Docker-режима это почти всегда разные значения — см. «Конфигурация» ниже)
- Настроит `.env` (права `600` — там пароль XMPP и секретные ключи)
- Сгенерирует случайный `API_TOKEN` и пропишет его в кнопку UI
- Добавит кнопку в UI Jitsi (вставляется внутрь существующего `server{}`-блока nginx, а не в конец файла)
- Создаст XMPP-пользователя `recorder`
- Соберёт и запустит сервис

Скрипт идемпотентен для nginx/UI-интеграции (повторный запуск не задублирует блок), но **не** для секретов — при повторном запуске на уже настроенном сервере он сгенерирует новый `XMPP_PASSWORD`/`API_TOKEN`, которые разъедутся с уже зарегистрированным XMPP-пользователем. Если нужно просто пересоздать пользователя или токен — сделайте это вручную (см. Troubleshooting), не гоняя установщик повторно.

### 📖 Документация
- Установка
- API Reference
- Конфигурация
- Troubleshooting

### 🔌 API Endpoints

Все эндпоинты, кроме `GET /health`, требуют заголовок `Authorization: Bearer <API_TOKEN>`, если `API_TOKEN` задан в `.env` (по умолчанию установщик его генерирует).

Начать запись
```bash
curl -X POST http://localhost:3000/recordings \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_TOKEN" \
  -d '{"room": "my-meeting", "displayName": "Recorder Bot"}'
```

Остановить запись
```bash
curl -X POST http://localhost:3000/recordings/my-meeting/stop \
  -H "Authorization: Bearer $API_TOKEN"
```

Список активных записей
```bash
curl -H "Authorization: Bearer $API_TOKEN" http://localhost:3000/recordings
```

Получить подписанную ссылку
```bash
curl -H "Authorization: Bearer $API_TOKEN" http://localhost:3000/sign/filename.webm
```

### 🎨 UI Integration
После установки в меню ⋯ Jitsi появляется пункт «🎙 Призвать бота записи»:
1. Нажмите ⋯ в комнате
2. Кликните «🎙 Призвать бота записи»
3. Бот заходит и начинает запись
4. Кнопка становится «✅ Бот уже пишет встречу» (заблокирована)
5. Когда все выйдут — автостоп через 10 сек

`summon-bot.js` подставляет `API_TOKEN` автоматически при установке, так что кнопка работает из коробки. Кнопка ищется по тексту существующих пунктов меню Jitsi (рус/англ) — если после обновления Jitsi Meet UI кнопка перестала появляться, вероятно поменялась вёрстка/локализация overflow-меню, и якорь в `summon-bot.js` нужно поправить под новую структуру.

### ⚙️ Конфигурация
Редактируйте `.env`:

```bash
# Jitsi
JITSI_BASE_URL=https://meet.example.com      # ваш ПУБЛИЧНЫЙ домен
BOSH_URL=http://prosody:5280/http-bind

# Внутренний XMPP-домен prosody — в Docker-установке это ПОЧТИ ВСЕГДА
# "meet.jitsi" / "muc.meet.jitsi", а НЕ ваш публичный домен выше.
# Установщик подставляет их автоматически; меняйте вручную только если
# у вас нестандартная конфигурация docker-jitsi-meet.
XMPP_DOMAIN=meet.jitsi
MUC_DOMAIN=muc.meet.jitsi

# XMPP
XMPP_USER=recorder
XMPP_PASSWORD=your-password

# Запись
OUTPUT_FORMAT=webm
AUTO_STOP_DELAY_MS=10000
TZ_OFFSET_H=3

# Безопасность
API_TOKEN=random-64-chars           # генерируется установщиком автоматически
FILE_ACCESS_SECRET_KEY=random-64-chars
FILE_ACCESS_EXPIRES_MINUTES=15

# Fireflies (опционально)
FIREFLIES_ENABLED=true
FIREFLIES_API_KEY=your-key
DELETE_AFTER_UPLOAD=false
```

### ⚙📊 Производительность
- Тест с 5 параллельными записями:
- CPU: ~5% (1% на комнату)
- RAM: ~120 MB (24 MB на комнату)
- Масштабируемость: ~50+ параллельных записей на типичном VPS

### 🔒 Безопасность
- **API Token**: установщик генерирует его сам и прописывает в `.env` и в `summon-bot.js`. Имейте в виду: `summon-bot.js` отдаётся публично всем посетителям сайта, поэтому токен виден любому, кто откроет исходный код страницы (F12 → Sources). Он останавливает случайное/автоматическое обнаружение API сканерами, но не защитит от человека, который целенаправленно будет искать. Для полноценной защиты нужна реальная авторизация в самом Jitsi (JWT/модераторы) — без неё эндпоинт в принципе не может быть закрыт «от своих», раз кнопка должна работать для любого гостя.
- **Подписанные URL**: файлы доступны только по токену (15 мин)
- **Network**: API слушает `0.0.0.0:3000` — ограничьте firewall'ом
- **XMPP**: используйте сложный пароль для recorder (установщик генерирует случайный, если оставить пустым)
- **`.env`**: создаётся с правами `600` — не понижайте их вручную, там пароль и секретные ключи

### 🐛 Troubleshooting

**Бот не заходит / в логах `XMPP connection dropped!`**
- Обычно это значит, что XMPP-пользователь `recorder` не был создан. Проверьте:
  ```bash
  docker exec <prosody-контейнер> prosodyctl --config /config/prosody.cfg.lua about
  ```
  Флаг `--config /config/prosody.cfg.lua` обязателен — у образа `jitsi/prosody` `prosodyctl`, вызванный через `docker exec`, не находит конфиг по дефолтному пути `/etc/prosody/prosody.cfg.lua` ([известный баг образа](https://github.com/jitsi/docker-jitsi-meet/issues/109)). Установщик уже учитывает это, но если пересоздаёте пользователя вручную — не забудьте флаг.
- Пересоздать/сменить пароль пользователя вручную (совпадает с `XMPP_PASSWORD` в `.env`):
  ```bash
  PW=$(grep '^XMPP_PASSWORD=' .env | cut -d= -f2-)
  docker exec <prosody-контейнер> prosodyctl --config /config/prosody.cfg.lua register recorder meet.jitsi "$PW"
  docker restart jitsi-audio-recorder
  ```
- Проверьте BOSH: `curl http://your-server:5280/http-bind` (изнутри docker-сети — снаружи порт обычно не проброшен, это нормально)
- Проверьте, что `XMPP_DOMAIN`/`MUC_DOMAIN` в `.env` — это внутренний домен (`meet.jitsi`), а не ваш публичный домен

**Кнопка не появляется**
- Очистите кеш браузера (Ctrl+F5)
- Проверьте Console (F12) на ошибки
- Убедитесь что `summon-bot.js` отдаётся: `curl https://ваш-домен/summon-bot.js`

**Ошибка HTTP 500 при клике на кнопку**
- Смотрите логи: `docker compose logs audio-recorder` — почти всегда это провал подключения к XMPP (см. пункт выше про `--config`)

**Запись тишина**
- Включите микрофоны участников
- Проверьте логи: `docker logs jitsi-audio-recorder`
- См. Troubleshooting Guide для подробностей.

### 📄 License
MIT License — см. LICENSE

### 🙏 Acknowledgments
https://jitsi.org/ — WebRTC видео-конференции
https://www.npmjs.com/package/@roamhq/wrtc — WebRTC для Node.js
https://fireflies.ai/ — транскрипция и AI-анализ

Made with ❤️ for the Jitsi community
