'use strict';

require('./polyfills');
const { wrtc } = require('./polyfills');
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const fetchLibJitsiMeet = require('./fetchLibJitsiMeet');
const RecorderSession = require('./RecorderSession');

const PORT = process.env.PORT || 3000;
const JITSI_BASE_URL = process.env.JITSI_BASE_URL;
const XMPP_DOMAIN = process.env.XMPP_DOMAIN;
const MUC_DOMAIN = process.env.MUC_DOMAIN;
const OUTPUT_DIR = process.env.OUTPUT_DIR || '/recordings';
const VENDOR_DIR = process.env.VENDOR_DIR || '/app/vendor';
const BOSH_URL = process.env.BOSH_URL || 'http://prosody:5280/http-bind';
const API_TOKEN = process.env.API_TOKEN || null;
const SECRET_KEY = process.env.FILE_ACCESS_SECRET_KEY || 'change-me-secret';
const EXPIRES_MINUTES = parseInt(process.env.FILE_ACCESS_EXPIRES_MINUTES || '15', 10);

const sessions = new Map();

function requireEnv(name, value) {
  if (!value) throw new Error(`Missing required env var ${name}. See .env.example.`);
  return value;
}

// === Подписанные URL (временный доступ к файлам) ===
function makeSignature(filename, expires) {
  return crypto.createHmac('sha256', SECRET_KEY).update(`${filename}:${expires}`).digest('hex');
}

function signedPath(filename) {
  const expires = Date.now() + EXPIRES_MINUTES * 60 * 1000;
  return `/download/${encodeURIComponent(filename)}?token=${makeSignature(filename, expires)}&expires=${expires}`;
}

async function main() {
  requireEnv('JITSI_BASE_URL', JITSI_BASE_URL);
  requireEnv('XMPP_DOMAIN', XMPP_DOMAIN);

  const libPath = await fetchLibJitsiMeet(JITSI_BASE_URL, `${VENDOR_DIR}/lib-jitsi-meet.min.js`);
  const JitsiMeetJS = require(libPath);

  if (JitsiMeetJS.setLogLevel) {
    JitsiMeetJS.setLogLevel(JitsiMeetJS.logLevels?.ERROR ?? 3);
  }
  JitsiMeetJS.init({ disableAudioLevels: true });

  const jitsiOptions = {
    hosts: {
      domain: XMPP_DOMAIN,
      muc: MUC_DOMAIN || `muc.${XMPP_DOMAIN}`
    },
    serviceUrl: BOSH_URL,
    clientNode: 'https://jitsi.org/jitsimeet'
  };

  const app = express();
  app.use(express.json());

  // CORS - чтобы кнопка в Jitsi могла дёргать API
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  // Опциональная авторизация токеном
  app.use((req, res, next) => {
    if (!API_TOKEN) return next();
    const token = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
    if (token !== API_TOKEN) return res.status(401).json({ error: 'unauthorized' });
    next();
  });

  // === Записи ===
  app.post('/recordings', async (req, res) => {
    const { room, displayName } = req.body || {};
    if (!room) return res.status(400).json({ error: 'room is required' });
    if (sessions.has(room)) return res.status(409).json({ error: 'already recording this room' });

    let session;
    session = new RecorderSession({
      roomName: room,
      JitsiMeetJS,
      wrtc,
      outputDir: OUTPUT_DIR,
      jitsiOptions,
      displayName,
      onStopped: (file) => {
        sessions.delete(room);
        console.log(`[api] recording finished: ${room} -> ${file}`);
      }
    });

    try {
      await session.start();
      sessions.set(room, session);
      res.json({ status: 'recording', room, file: session.outputPath });
    } catch (err) {
      sessions.delete(room);
      res.status(500).json({ error: String(err && err.message ? err.message : err) });
    }
  });

  app.post('/recordings/:room/stop', async (req, res) => {
    const session = sessions.get(req.params.room);
    if (!session) return res.status(404).json({ error: 'no active recording for this room' });

    try {
      const file = await session.stop();
      sessions.delete(req.params.room);
      const filename = path.basename(file);
      res.json({
        status: 'stopped',
        room: req.params.room,
        file,
        downloadUrl: signedPath(filename),
        expiresInMinutes: EXPIRES_MINUTES
      });
    } catch (err) {
      res.status(500).json({ error: String(err && err.message ? err.message : err) });
    }
  });

  app.get('/recordings', (req, res) => {
    res.json({ active: Array.from(sessions.keys()) });
  });

  // === Списки файлов ===
  app.get('/files', (req, res) => {
    res.json(fs.readdirSync(OUTPUT_DIR).filter((f) => /\.(webm|ogg|mp3|m4a|mp4|wav)$/.test(f)));
  });

  app.get('/files/:room', (req, res) => {
    const prefix = (req.params.room + '-').toLowerCase();
    res.json(fs.readdirSync(OUTPUT_DIR).filter((f) => f.toLowerCase().startsWith(prefix)));
  });

  // === Получить подписанную ссылку по запросу ===
  app.get('/sign/:filename', (req, res) => {
    const filename = req.params.filename;
    if (!fs.existsSync(path.join(OUTPUT_DIR, filename))) {
      return res.status(404).json({ error: 'file not found' });
    }
    res.json({ downloadUrl: signedPath(filename), expiresInMinutes: EXPIRES_MINUTES });
  });

  // === Защищённое скачивание (только с валидной подписью) ===
  app.get('/download/:filename', (req, res) => {
    const filename = req.params.filename;
    const { token, expires } = req.query;
    if (!token || !expires) return res.status(401).json({ error: 'missing signature' });
    if (Date.now() > parseInt(expires, 10)) return res.status(401).json({ error: 'url expired' });
    if (token !== makeSignature(filename, expires)) return res.status(401).json({ error: 'invalid signature' });

    const full = path.join(OUTPUT_DIR, filename);
    if (!fs.existsSync(full)) return res.status(404).json({ error: 'file not found' });
    res.sendFile(full);
  });

  app.get('/health', (req, res) => res.json({ ok: true }));

  app.listen(PORT, () => console.log(`jitsi-audio-recorder listening on :${PORT}`));
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
