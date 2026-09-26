# Troubleshooting

## Бот не заходит в комнату

- curl http://<server>:5280/http-bind — BOSH должен отвечать
- проверьте пользователя: prosodyctl register recorder <domain> <pass>
- логи: docker compose logs -f audio-recorder
- ошибки extdisco / querySelectorAll в логах — НЕ критичны, игнорируйте

## Кнопка не появляется в меню

- Ctrl+F5 (сброс кеша)
- F12 -> Console: проверьте что /summon-bot.js загружается (200)
- убедитесь что sub_filter есть в nginx-конфиге и nginx перезагружен

## Кнопка влезает внутрь другой строки меню

- это баг старой версии скрипта; текущая версия из injection/summon-bot.js
  ищет строку-якорь универсально (по структуре DOM, без ролей и классов)

## Запись пустая или тихая

- участники должны включить микрофон
- проверьте что бот виден в комнате как участник

## /recorder-api возвращает index.html вместо JSON

- нужен модификатор ^~ :  location ^~ /recorder-api/ { ... }

## Fireflies: 415 Unsupported Media Type

- не используйте multipart-загрузку файла;
  правильный метод — uploadAudio(input: {url}) с подписанным URL
  (уже реализовано в src/fireflies.js)

## Fireflies: Cannot query field "addAudio"

- правильное имя мутации — uploadAudio,
  возвращает AudioUploadStatus {success, title, message};
  ID транскрипта получается polling-ом transcripts(title: ...)
