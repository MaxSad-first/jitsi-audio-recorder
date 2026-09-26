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
```

# Запустить установщик
```bash
chmod +x install.sh
sudo ./install.sh
```

### Установщик:
- Проверит зависимости
- Спросит тип установки (Docker/standalone)
- Настроит .env
- Добавит кнопку в UI Jitsi
- Создаст XMPP-пользователя
- Запустит сервис

### 📖 Документация
- Установка
- API Reference
- Конфигурация
- Troubleshooting

### 🔌 API Endpoints
Начать запись
```bash
curl -X POST http://localhost:3000/recordings \
  -H "Content-Type: application/json" \
  -d '{"room": "my-meeting", "displayName": "Recorder Bot"}'
```

Остановить запись
```bash
curl -X POST http://localhost:3000/recordings/my-meeting/stop
```

Список активных записей
```bash
curl http://localhost:3000/recordings
```

Получить подписанную ссылку
```bash
curl http://localhost:3000/sign/filename.webm
```

### 🎨 UI Integration
После установки в меню ⋯ Jitsi появляется пункт «🎙 Призвать бота записи»:
1. Нажмите ⋯ в комнате
2. Кликните «🎙 Призвать бота записи»
3. Бот заходит и начинает запись
4. Кнопка становится «✅ Бот уже пишет встречу» (заблокирована)
5. Когда все выйдут — автостоп через 10 сек

### ⚙️ Конфигурация
Редактируйте .env:

```bash
# Jitsi
JITSI_BASE_URL=https://meet.example.com
BOSH_URL=http://prosody:5280/http-bind
XMPP_DOMAIN=meet.example.com
MUC_DOMAIN=muc.meet.example.com

# XMPP
XMPP_USER=recorder
XMPP_PASSWORD=your-password

# Запись
OUTPUT_FORMAT=webm
AUTO_STOP_DELAY_MS=10000
TZ_OFFSET_H=3

# Безопасность
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
- API Token: установите API_TOKEN в .env для авторизации
- Подписанные URL: файлы доступны только по токену (15 мин)
- Network: API слушает 0.0.0.0:3000 — ограничьте firewall'ом
- XMPP: используйте сложный пароль для recorder

### 🐛 Troubleshooting
Бот не заходит
- Проверьте BOSH: curl http://your-server:5280/http-bind
- Проверьте XMPP: prosodyctl about
- Firewall: порт 5280 должен быть доступен
Кнопка не появляется
- Очистите кеш браузера (Ctrl+F5)
- Проверьте Console (F12) на ошибки
- Убедитесь что summon-bot.js отдаётся
Запись тишина
- Включите микрофоны участников
- Проверьте логи: docker logs jitsi-audio-recorder
- См. Troubleshooting Guide для подробностей.

### 📄 License
MIT License — см. LICENSE

### 🙏 Acknowledgments
https://jitsi.org/ — WebRTC видео-конференции
https://www.npmjs.com/package/@roamhq/wrtc — WebRTC для Node.js
https://fireflies.ai/ — транскрипция и AI-анализ

Made with ❤️ for the Jitsi community
