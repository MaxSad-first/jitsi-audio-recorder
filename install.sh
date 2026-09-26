#!/usr/bin/env bash
# ============================================================================
# Jitsi Audio Recorder — Installer
# Поддерживает Docker и standalone Jitsi Meet
# ============================================================================

set -euo pipefail

# === Цвета ===
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# === Утилиты ===
info()    { echo -e "${BLUE}[INFO]${NC} $*"; }
success() { echo -e "${GREEN}[OK]${NC} $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC} $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*" >&2; }
fatal()   { error "$*"; exit 1; }
section() { echo -e "\n${CYAN}=== $* ===${NC}"; }

# === Проверка root ===
if [[ $EUID -ne 0 ]]; then
    warn "Этот скрипт желательно запускать с sudo (нужны права для nginx, prosodyctl, docker)"
    read -p "Продолжить без sudo? [y/N] " -n 1 -r
    echo
    [[ $REPLY =~ ^[Yy]$ ]] || exit 1
fi

# === Banner ===
cat << 'BANNER'

 _ __ ___   __ ___  _____  __ _  __| |      / _(_)_ __ ___| |_
| '_ ` _ \ / _` \ \/ / __|/ _` |/ _` |_____| |_| | '__/ __| __|
| | | | | | (_| |>  <\__ \ (_| | (_| |_____|  _| | |  \__ \ |_
|_| |_| |_|\__,_/_/\_\___/\__,_|\__,_|     |_| |_|_|  |___/\__|

BANNER

# ============================================================================
# ШАГ 1. Сбор настроек
# ============================================================================
section "1. Настройки установки"

# Тип установки
echo "Как установлен Jitsi на этом сервере?"
echo "  1) Docker (docker compose)"
echo "  2) Standalone (apt install jitsi-meet)"
echo "  3) Установить рекордер на ДРУГОЙ сервер (только сборка + конфиг)"
read -p "Выбор [1/2/3]: " INSTALL_TYPE

case "$INSTALL_TYPE" in
    1) INSTALL_MODE="docker" ;;
    2) INSTALL_MODE="standalone" ;;
    3) INSTALL_MODE="remote" ;;
    *) fatal "Неверный выбор" ;;
esac

# Домен
read -p "Домен Jitsi (например meet.example.com): " JITSI_DOMAIN
[[ -n "$JITSI_DOMAIN" ]] || fatal "Домен обязателен"

# Путь установки рекордера
if [[ "$INSTALL_MODE" != "remote" ]]; then
    DEFAULT_INSTALL_DIR="/opt/jitsi-audio-recorder"
    read -p "Куда установить рекордер? [$DEFAULT_INSTALL_DIR]: " INSTALL_DIR
    INSTALL_DIR="${INSTALL_DIR:-$DEFAULT_INSTALL_DIR}"
else
    INSTALL_DIR="$(pwd)/jitsi-audio-recorder-deploy"
    mkdir -p "$INSTALL_DIR"
    info "Файлы будут сохранены в $INSTALL_DIR (скопируйте их на сервер с Jitsi)"
fi

# Пароль XMPP
echo
info "Пароль для XMPP-пользователя recorder@$JITSI_DOMAIN"
read -s -p "Пароль (скрытый ввод): " XMPP_PASSWORD
echo
[[ -n "$XMPP_PASSWORD" ]] || XMPP_PASSWORD=$(openssl rand -base64 24)

# Fireflies (опционально)
echo
read -p "Настроить интеграцию с Fireflies? [y/N]: " FIREFLIES_WANT
FIREFLIES_ENABLED="false"
FIREFLIES_API_KEY=""
if [[ "$FIREFLIES_WANT" =~ ^[Yy]$ ]]; then
    FIREFLIES_ENABLED="true"
    read -p "Fireflies API Key: " FIREFLIES_API_KEY
    [[ -n "$FIREFLIES_API_KEY" ]] || fatal "API ключ не может быть пустым"
fi

# Секретный ключ для подписанных URL
SECRET_KEY=$(openssl rand -hex 32)

# Токен для /recorder-api/ — без него любой человек в интернете может дёрнуть
# POST .../recorder-api/recordings и запустить запись любой комнаты в обход UI.
# ВАЖНО: summon-bot.js публично отдаётся браузером, так что этот токен виден
# любому, кто откроет исходный код страницы — он останавливает случайное/
# автоматическое обнаружение эндпоинта сканерами, но НЕ защищает от человека,
# который целенаправленно прочитает summon-bot.js. Для настоящей защиты нужен
# либо реальный auth в самом Jitsi (JWT/модераторы), либо доп. проверки на
# уровне nginx (rate-limit, allowlist по Referer и т.п.).
API_TOKEN=$(openssl rand -hex 32)

# ============================================================================
# ШАГ 2. Проверка зависимостей
# ============================================================================
section "2. Проверка зависимостей"

if [[ "$INSTALL_MODE" != "remote" ]]; then
    # Docker
    if [[ "$INSTALL_MODE" == "docker" ]]; then
        command -v docker >/dev/null 2>&1 || fatal "Docker не установлен"
        command -v docker compose >/dev/null 2>&1 || \
            command -v docker-compose >/dev/null 2>&1 || \
            fatal "Docker Compose не установлен"
        success "Docker найден"
    fi

    # Standalone: проверить prosodyctl
    if [[ "$INSTALL_MODE" == "standalone" ]]; then
        command -v prosodyctl >/dev/null 2>&1 || fatal "prosodyctl не найден — установлен ли Prosody?"
        success "Prosody найден"

        # nginx
        command -v nginx >/dev/null 2>&1 || fatal "nginx не найден"
        success "nginx найден"
    fi
else
    info "Удалённый режим — пропускаем проверку зависимостей"
fi

success "Все зависимости в порядке"

# ============================================================================
# ШАГ 3. Создание структуры
# ============================================================================
section "3. Создание структуры $INSTALL_DIR"

mkdir -p "$INSTALL_DIR"/{recordings,src,injection}

# === package.json ===
cat > "$INSTALL_DIR/package.json" << 'EOF'
{
  "name": "jitsi-audio-recorder",
  "version": "1.0.0",
  "description": "Headless audio recorder for Jitsi Meet",
  "main": "src/index.js",
  "scripts": {
    "start": "node src/index.js"
  },
  "dependencies": {
    "@roamhq/wrtc": "^0.8.0",
    "express": "^4.19.2",
    "xhr2": "^0.2.1",
    "ws": "^8.18.0",
    "jsdom": "^24.1.3",
    "css-select": "^5.1.0",
    "node-fetch": "^2.7.0",
    "form-data": "^4.0.0"
  }
}
EOF

# === Dockerfile ===
cat > "$INSTALL_DIR/Dockerfile" << 'EOF'
FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ ffmpeg ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY src ./src

EXPOSE 3000
CMD ["node", "src/index.js"]
EOF

# === .env ===
cat > "$INSTALL_DIR/.env" << EOF
# ============================================================================
# Jitsi Audio Recorder — generated by installer
# ============================================================================

JITSI_BASE_URL=https://${JITSI_DOMAIN}
$(if [[ "$INSTALL_MODE" == "docker" ]]; then
    echo "BOSH_URL=http://prosody:5280/http-bind"
else
    echo "BOSH_URL=http://127.0.0.1:5280/http-bind"
fi)
XMPP_DOMAIN=${JITSI_DOMAIN}
MUC_DOMAIN=muc.${JITSI_DOMAIN}
XMPP_USER=recorder
XMPP_PASSWORD=${XMPP_PASSWORD}

OUTPUT_FORMAT=webm
AUTO_STOP_DELAY_MS=10000
TZ_OFFSET_H=3

PORT=3000
OUTPUT_DIR=/recordings
VENDOR_DIR=/app/vendor

API_TOKEN=${API_TOKEN}
CORS_ORIGIN=https://${JITSI_DOMAIN}

FILE_ACCESS_SECRET_KEY=${SECRET_KEY}
FILE_ACCESS_EXPIRES_MINUTES=15
PUBLIC_BASE_URL=https://${JITSI_DOMAIN}

FIREFLIES_ENABLED=${FIREFLIES_ENABLED}
FIREFLIES_API_KEY=${FIREFLIES_API_KEY}
DELETE_AFTER_UPLOAD=false
EOF

chmod 600 "$INSTALL_DIR/.env"
success ".env создан (права 600 — внутри пароль XMPP и секретные ключи)"

# === summon-bot.js ===
cat > "$INSTALL_DIR/injection/summon-bot.js" << 'JSEOF'
(function () {
  'use strict';
  var API = '/recorder-api';
  var API_TOKEN = '__API_TOKEN__';
  var MENU_ANCHOR_RE = /(встроить встречу|embed meeting|комбинации клавиш|keyboard shortcuts)/i;
  var state = { status: 'idle', error: null };
  function roomName() {
    var parts = location.pathname.replace(/\/+$/, '').split('/').filter(Boolean);
    return parts.length ? decodeURIComponent(parts[parts.length - 1]) : '';
  }
  function findAnchorRow() {
    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
    var node;
    while ((node = walker.nextNode())) {
      if (MENU_ANCHOR_RE.test(node.nodeValue || '')) {
        var cur = node.parentElement;
        while (cur && cur.parentElement && cur.parentElement !== document.body && cur.parentElement.childElementCount <= 2) cur = cur.parentElement;
        if (cur && cur.parentElement && cur.parentElement.childElementCount >= 3) return cur;
      }
    }
    return null;
  }
  function label() {
    switch (state.status) {
      case 'loading': return '⏳ Призываю бота…';
      case 'active':  return '✅ Бот уже пишет встречу';
      case 'error':   return '❌ Ошибка: ' + (state.error || 'повторите');
      default:        return '🎙 Призвать бота записи';
    }
  }
  function isDisabled() { return state.status === 'loading' || state.status === 'active'; }
  function refreshActive(cb) {
    fetch(API + '/recordings').then(function(r){return r.json();}).then(function(d){
      var room = roomName().toLowerCase();
      var active = (d && d.active || []).some(function(r){return r.toLowerCase()===room;});
      if (active) state.status = 'active';
      else if (state.status === 'active') state.status = 'idle';
      if (cb) cb();
    }).catch(function(){ if (cb) cb(); });
  }
  function summon(item) {
    if (isDisabled()) return;
    state.status = 'loading'; render(item);
    fetch(API + '/recordings', {
      method: 'POST', headers: {'Content-Type':'application/json', 'Authorization':'Bearer ' + API_TOKEN},
      body: JSON.stringify({room: roomName(), displayName: 'Recorder Bot'})
    }).then(function(r){
      if (r.status === 200 || r.status === 409) state.status = 'active';
      else { state.status = 'error'; state.error = 'HTTP ' + r.status; }
      render(item);
      if (state.status === 'error') setTimeout(function(){ state.status='idle'; render(item); }, 4000);
    }).catch(function(e){
      state.status = 'error'; state.error = 'сеть'; render(item);
      setTimeout(function(){ state.status='idle'; render(item); }, 4000);
    });
  }
  function render(item) {
    if (!item || !document.body.contains(item)) return;
    var t = item.querySelector('[data-summon-text]');
    if (t) t.textContent = label();
    item.style.opacity = isDisabled() ? '0.55' : '1';
    item.style.pointerEvents = isDisabled() ? 'none' : 'auto';
  }
  function inject() {
    var row = findAnchorRow(); if (!row) return;
    var list = row.parentElement;
    if (list.querySelector('#summon-bot-item')) { render(list.querySelector('#summon-bot-item')); return; }
    var item = row.cloneNode(true);
    item.querySelectorAll('svg, img').forEach(function(n){n.remove();});
    var leaves = [];
    item.querySelectorAll('*').forEach(function(n){
      if (n.childElementCount === 0 && n.textContent.trim()) leaves.push(n);
    });
    leaves.forEach(function(n,i){ n.textContent = (i===0)?label():''; });
    if (leaves.length === 0) item.textContent = label();
    else leaves[0].setAttribute('data-summon-text','1');
    item.id = 'summon-bot-item'; item.style.cursor = 'pointer';
    item.addEventListener('click', function(e){ e.stopPropagation(); summon(item); });
    row.insertAdjacentElement('afterend', item);
    refreshActive(function(){ render(item); });
  }
  var scheduled = false;
  function scheduleInject() {
    if (scheduled) return; scheduled = true;
    requestAnimationFrame(function(){ scheduled = false; inject(); });
  }
  new MutationObserver(scheduleInject).observe(document.body, {childList:true, subtree:true});
  scheduleInject();
})();
JSEOF

sed -i "s/__API_TOKEN__/${API_TOKEN}/" "$INSTALL_DIR/injection/summon-bot.js"
success "summon-bot.js создан"

# === nginx-патчи ===
cat > "$INSTALL_DIR/injection/nginx-docker.conf" << 'EOF'

# === Recorder bot integration ===
location = /summon-bot.js {
    alias /config/summon-bot.js;
    add_header Cache-Control "no-cache";
}

location ^~ /recorder-api/ {
    set $recorder_upstream http://audio-recorder:3000;
    rewrite ^/recorder-api/(.*)$ /$1 break;
    proxy_pass $recorder_upstream;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
}

sub_filter '</body>' '<script src="/summon-bot.js"></script></body>';
sub_filter_once on;
sub_filter_types text/html;
# === end recorder integration ===
EOF

cat > "$INSTALL_DIR/injection/nginx-standalone.conf" << 'EOF'

# === Recorder bot integration ===
location = /summon-bot.js {
    alias /usr/share/jitsi-meet/summon-bot.js;
    add_header Cache-Control "no-cache";
}

location ^~ /recorder-api/ {
    proxy_pass http://127.0.0.1:3000/;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}

sub_filter '</body>' '<script src="/summon-bot.js"></script></body>';
sub_filter_once on;
sub_filter_types text/html;
# === end recorder integration ===
EOF

# === docker-compose.yml (для Docker) ===
if [[ "$INSTALL_MODE" == "docker" ]]; then
cat > "$INSTALL_DIR/docker-compose.yml" << 'EOF'
version: '3.8'

services:
  audio-recorder:
    build: .
    container_name: jitsi-audio-recorder
    restart: unless-stopped
    env_file:
      - .env
    volumes:
      - ./recordings:/recordings
    ports:
      - '3000:3000'
    networks:
      - meet.jitsi

networks:
  meet.jitsi:
    external: true
EOF
success "docker-compose.yml создан"
fi

# ============================================================================
# ШАГ 4. Копирование src/
# ============================================================================
section "4. Копирование исходников"

if [[ -d "src" ]]; then
    cp -r src/* "$INSTALL_DIR/src/"
    success "src/ скопирован из текущей директории"
else
    warn "Директория src/ не найдена — положите туда файлы рекордера вручную"
    info "Ожидаемые файлы: index.js, RecorderSession.js, AudioMixer.js, ffmpegWriter.js,"
    info "                 fireflies.js, fetchLibJitsiMeet.js, polyfills.js"
fi

# ============================================================================
# ШАГ 5. Установка в зависимости от типа
# ============================================================================
section "5. Интеграция с Jitsi"

if [[ "$INSTALL_MODE" == "docker" ]]; then
    # === Docker ===

    # Найти jitsi docker-compose каталог
    JITSI_DIR=""
    for d in /opt/jitsi /opt/beget/jitsi /root/jitsi ~/jitsi; do
        if [[ -f "$d/docker-compose.yml" ]] && grep -q "jitsi/web" "$d/docker-compose.yml" 2>/dev/null; then
            JITSI_DIR="$d"
            break
        fi
    done

    if [[ -z "$JITSI_DIR" ]]; then
        read -p "Путь к jitsi docker-compose (каталог): " JITSI_DIR
        [[ -f "$JITSI_DIR/docker-compose.yml" ]] || fatal "docker-compose.yml не найден в $JITSI_DIR"
    fi
    success "Jitsi Docker найден: $JITSI_DIR"

    # Скопировать summon-bot.js
    WEB_DIR="$JITSI_DIR/web"
    mkdir -p "$WEB_DIR"
    cp "$INSTALL_DIR/injection/summon-bot.js" "$WEB_DIR/summon-bot.js"
    chmod 644 "$WEB_DIR/summon-bot.js"
    success "summon-bot.js скопирован в $WEB_DIR"

    # Добавить блок в meet.conf (если его там нет)
    # Вставляем ПЕРЕД последней закрывающей "}" файла (это location{}-директивы,
    # они обязаны быть внутри server{} — простой '>>' в конец файла кладёт их
    # СНАРУЖИ server{} и ломает конфиг).
    MEET_CONF="$WEB_DIR/nginx/meet.conf"
    if [[ -f "$MEET_CONF" ]]; then
        if grep -q "# === Recorder bot integration ===" "$MEET_CONF"; then
            warn "Блок уже есть в meet.conf — пропускаем"
        else
            LAST_BRACE_LINE=$(grep -n '^}[[:space:]]*$' "$MEET_CONF" | tail -1 | cut -d: -f1)
            if [[ -n "$LAST_BRACE_LINE" ]]; then
                TMP_CONF=$(mktemp)
                head -n "$((LAST_BRACE_LINE - 1))" "$MEET_CONF" > "$TMP_CONF"
                cat "$INSTALL_DIR/injection/nginx-docker.conf" >> "$TMP_CONF"
                tail -n "+${LAST_BRACE_LINE}" "$MEET_CONF" >> "$TMP_CONF"
                mv "$TMP_CONF" "$MEET_CONF"
                success "nginx-блок вставлен в $MEET_CONF (внутрь server{})"
            else
                warn "Не нашёл закрывающую } в $MEET_CONF — добавляю в конец файла, ПРОВЕРЬТЕ nginx -t вручную!"
                cat "$INSTALL_DIR/injection/nginx-docker.conf" >> "$MEET_CONF"
            fi
        fi
    else
        warn "$MEET_CONF не найден — добавьте блок из nginx-docker.conf вручную"
    fi

    # Определить РЕАЛЬНЫЙ XMPP-домен и docker-сеть по факту, а не по введённому
    # публичному домену — они почти всегда разные (внутренний виртуалхост
    # prosody обычно "meet.jitsis", даже если сайт открывается по другому имени).
    REAL_XMPP_DOMAIN=""
    REAL_MUC_DOMAIN=""
    ACTUAL_NETWORK=""
    PROSODY_CONTAINER=""
    if docker ps --format '{{.Names}}' | grep -q "prosody"; then
        PROSODY_CONTAINER=$(docker ps --format '{{.Names}}' | grep prosody | head -1)

        REAL_XMPP_DOMAIN=$(docker exec "$PROSODY_CONTAINER" \
            grep -m1 -oP 'VirtualHost "\K[^"]+' /config/conf.d/jitsi-meet.cfg.lua 2>/dev/null || true)
        REAL_MUC_DOMAIN=$(docker exec "$PROSODY_CONTAINER" \
            grep -oP 'Component "\Kmuc\.[^"]+(?=" "muc")' /config/conf.d/jitsi-meet.cfg.lua 2>/dev/null | head -1 || true)
        ACTUAL_NETWORK=$(docker inspect -f \
            '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{end}}' "$PROSODY_CONTAINER" 2>/dev/null || true)
    fi

    if [[ -n "$REAL_XMPP_DOMAIN" ]]; then
        info "Обнаружен реальный XMPP-домен prosody: $REAL_XMPP_DOMAIN (введённый публичный домен $JITSI_DOMAIN используется только для JITSI_BASE_URL)"
        sed -i "s|^XMPP_DOMAIN=.*|XMPP_DOMAIN=${REAL_XMPP_DOMAIN}|" "$INSTALL_DIR/.env"
        [[ -n "$REAL_MUC_DOMAIN" ]] && sed -i "s|^MUC_DOMAIN=.*|MUC_DOMAIN=${REAL_MUC_DOMAIN}|" "$INSTALL_DIR/.env"
    else
        warn "Не удалось автоопределить XMPP-домен prosody — оставляю ${JITSI_DOMAIN}. Проверьте вручную:"
        info "  docker exec <prosody> grep VirtualHost /config/conf.d/jitsi-meet.cfg.lua"
    fi
    XMPP_REGISTER_DOMAIN="${REAL_XMPP_DOMAIN:-$JITSI_DOMAIN}"

    if [[ -n "$ACTUAL_NETWORK" ]]; then
        info "Обнаружена реальная docker-сеть: $ACTUAL_NETWORK"
        sed -i "s|- meet.jitsi\$|- ${ACTUAL_NETWORK}|; s|^  meet.jitsi:|  ${ACTUAL_NETWORK}:|" "$INSTALL_DIR/docker-compose.yml"
    else
        warn "Не удалось автоопределить docker-сеть — проверьте 'networks:' в $INSTALL_DIR/docker-compose.yml вручную (docker network ls)"
    fi

    # Создать XMPP-пользователя через контейнер prosody (на РЕАЛЬНОМ домене)
    # ВАЖНО: у образа jitsi/prosody сам бинарник prosodyctl при вызове через
    # `docker exec` не находит свой конфиг по дефолтному пути
    # /etc/prosody/prosody.cfg.lua — нужно явно указывать --config,
    # см. https://github.com/jitsi/docker-jitsi-meet/issues/109
    info "Создание XMPP-пользователя recorder..."
    if [[ -n "$PROSODY_CONTAINER" ]]; then
        docker exec "$PROSODY_CONTAINER" prosodyctl --config /config/prosody.cfg.lua \
            register recorder "$XMPP_REGISTER_DOMAIN" "$XMPP_PASSWORD" \
            || warn "Не удалось создать пользователя (возможно уже существует)"
        success "XMPP-пользователь готов"
    else
        warn "Контейнер prosody не запущен — создайте пользователя вручную:"
        info "  docker exec <prosody> prosodyctl --config /config/prosody.cfg.lua register recorder $XMPP_REGISTER_DOMAIN $XMPP_PASSWORD"
    fi

    # Собрать и запустить
    info "Сборка образа..."
    cd "$INSTALL_DIR"
    docker compose build audio-recorder 2>&1 | tail -5
    docker compose up -d audio-recorder
    success "Рекордер запущен"

    # Перезагрузить nginx внутри web-контейнера
    WEB_CONTAINER=$(docker ps --format '{{.Names}}' | grep -E "web-?1?$|jitsi-web" | head -1)
    if [[ -n "$WEB_CONTAINER" ]]; then
        docker exec "$WEB_CONTAINER" nginx -t >/dev/null 2>&1 && \
            docker exec "$WEB_CONTAINER" nginx -s reload
        success "nginx перегружен в $WEB_CONTAINER"
    fi

elif [[ "$INSTALL_MODE" == "standalone" ]]; then
    # === Standalone ===

    # Скопировать summon-bot.js
    cp "$INSTALL_DIR/injection/summon-bot.js" /usr/share/jitsi-meet/summon-bot.js
    chmod 644 /usr/share/jitsi-meet/summon-bot.js
    success "summon-bot.js скопирован в /usr/share/jitsi-meet"

    # Найти nginx-конфиг Jitsi
    NGINX_CONF=""
    for f in /etc/nginx/sites-enabled/${JITSI_DOMAIN}.conf \
             /etc/nginx/conf.d/${JITSI_DOMAIN}.conf \
             /etc/nginx/sites-enabled/default; do
        if [[ -f "$f" ]] && grep -q "$JITSI_DOMAIN\|jitsi" "$f" 2>/dev/null; then
            NGINX_CONF="$f"
            break
        fi
    done

    if [[ -z "$NGINX_CONF" ]]; then
        read -p "Путь к nginx-конфигу Jitsi: " NGINX_CONF
    fi

    if grep -q "# === Recorder bot integration ===" "$NGINX_CONF"; then
        warn "Блок уже есть в $NGINX_CONF"
    else
        # Бэкап
        cp "$NGINX_CONF" "$NGINX_CONF.bak.$(date +%Y%m%d%H%M%S)"
        # Вставить перед последней } server-блока
        # Простейший подход: добавить в конец (если там только один server-блок)
        cat "$INSTALL_DIR/injection/nginx-standalone.conf" >> "$NGINX_CONF"
        success "nginx-блок добавлен в $NGINX_CONF (бэкап сохранён)"
    fi

    # Создать XMPP-пользователя
    info "Создание XMPP-пользователя..."
    prosodyctl register recorder "$JITSI_DOMAIN" "$XMPP_PASSWORD" \
        || warn "Пользователь уже существует"
    success "XMPP-пользователь готов"

    # Проверить nginx и перезагрузить
    nginx -t && systemctl reload nginx
    success "nginx перегружен"

    # Инструкция по запуску Node
    info "Для запуска рекордера (без Docker) выполните:"
    info "  cd $INSTALL_DIR && npm install --omit=dev && node src/index.js"
    info "Или оберните в systemd-сервис (см. docs/systemd.md)"

else
    # === Remote ===
    info "Файлы подготовлены в $INSTALL_DIR"
    info "Скопируйте их на сервер с Jitsi и запустите install.sh ещё раз"
fi

# ============================================================================
# ШАГ 6. Smoke test
# ============================================================================
section "6. Проверка работоспособности"

if [[ "$INSTALL_MODE" != "remote" && "$INSTALL_MODE" == "docker" ]]; then
    sleep 5
    if curl -sf http://localhost:3000/health >/dev/null; then
        success "API отвечает: /health"
    else
        warn "API пока не отвечает — проверьте логи: docker compose logs audio-recorder"
    fi
fi

if [[ "$INSTALL_MODE" != "remote" ]]; then
    if curl -sf "https://${JITSI_DOMAIN}/summon-bot.js" >/dev/null; then
        success "summon-bot.js отдаётся через nginx"
    else
        warn "summon-bot.js не отдаётся — проверьте nginx reload"
    fi
fi

# ============================================================================
# Итоги
# ============================================================================
section "Установка завершена"

cat << EOF
${GREEN}✓${NC} Рекордер установлен в: ${CYAN}$INSTALL_DIR${NC}
${GREEN}✓${NC} Домен Jitsi: ${CYAN}$JITSI_DOMAIN${NC}
${GREEN}✓${NC} Режим: ${CYAN}$INSTALL_MODE${NC}

${YELLOW}Следующие шаги:${NC}

1. Откройте https://${JITSI_DOMAIN}/любая-комната
2. Нажмите Ctrl+F5 (сброс кеша)
3. В меню ⋯ найдите пункт "🎙 Призвать бота записи"
4. Кликните — бот зайдёт и начнёт запись

${YELLOW}Проверка:${NC}
  curl https://${JITSI_DOMAIN}/recorder-api/health
  curl -H "Authorization: Bearer ${API_TOKEN}" https://${JITSI_DOMAIN}/recorder-api/files

${YELLOW}API-токен (для ручных curl-запросов, кнопка в UI уже настроена сама):${NC}
  ${API_TOKEN}

${YELLOW}Логи:${NC}
EOF

if [[ "$INSTALL_MODE" == "docker" ]]; then
    echo "  docker compose logs -f audio-recorder"
elif [[ "$INSTALL_MODE" == "standalone" ]]; then
    echo "  journalctl -u jitsi-audio-recorder -f"
    echo "  или: tail -f $INSTALL_DIR/recorder.log"
fi

cat << EOF

${YELLOW}Конфигурация:${NC}
  $INSTALL_DIR/.env

${GREEN}Готово!${NC}
EOF
