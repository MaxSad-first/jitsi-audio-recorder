# Installation Guide

## Docker (рекомендуется)

    git clone https://github.com/MaxSad-first/jitsi-audio-recorder.git
    cd jitsi-audio-recorder
    chmod +x install.sh
    sudo ./install.sh
    # выбрать: 1) Docker

Установщик сам:
- создаст .env
- скопирует summon-bot.js в том web-контейнера
- добавит nginx-блок в meet.conf
- создаст XMPP-пользователя recorder
- соберёт и запустит контейнер

## Standalone (apt)

    sudo ./install.sh
    # выбрать: 2) Standalone

Отличия от Docker:
- BOSH_URL=http://127.0.0.1:5280/http-bind
- summon-bot.js кладётся в /usr/share/jitsi-meet/
- nginx-блок добавляется в /etc/nginx/sites-enabled/<domain>.conf
- рекордер запускается через systemd или node src/index.js

## Ручная установка (без install.sh)

1. Скопировать проект, выполнить npm install --omit=dev
2. Заполнить .env по примеру examples/.env.example
3. Создать пользователя: prosodyctl register recorder <domain> <password>
4. Добавить блок из injection/nginx-docker.conf или injection/nginx-standalone.conf
5. Скопировать injection/summon-bot.js в web-рут Jitsi
6. Запустить: docker compose up -d  или  node src/index.js
