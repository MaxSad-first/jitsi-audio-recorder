# Configuration

Все настройки — в .env (пример: examples/.env.example).

| Переменная | Описание | По умолчанию |
|---|---|---|
| JITSI_BASE_URL | URL вашего Jitsi | — |
| BOSH_URL | XMPP BOSH endpoint | http://prosody:5280/http-bind |
| XMPP_DOMAIN | XMPP-домен | — |
| MUC_DOMAIN | MUC-домен | muc.<domain> |
| XMPP_USER / XMPP_PASSWORD | Учётка бота | recorder |
| OUTPUT_FORMAT | webm / ogg / mp3 / m4a / wav | webm |
| AUTO_STOP_DELAY_MS | Задержка автостопа | 10000 |
| TZ_OFFSET_H | Часовой пояс имён файлов | 3 |
| FILE_ACCESS_SECRET_KEY | Секрет подписанных URL | — |
| FILE_ACCESS_EXPIRES_MINUTES | TTL подписанных URL | 15 |
| PUBLIC_BASE_URL | Публичный URL для Fireflies | — |
| FIREFLIES_ENABLED | Включить транскрипцию | false |
| FIREFLIES_API_KEY | Ключ Fireflies | — |
| DELETE_AFTER_UPLOAD | Удалить файл после загрузки | false |
| API_TOKEN | Защита API (пусто = выкл) | — |
