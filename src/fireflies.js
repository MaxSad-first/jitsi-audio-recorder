'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const fetch = require('node-fetch');

const FIREFLIES_ENABLED = process.env.FIREFLIES_ENABLED === 'true';
const FIREFLIES_API_KEY = process.env.FIREFLIES_API_KEY || '';
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || 'https://becicuenuepad.beget.app';
const SECRET_KEY = process.env.FILE_ACCESS_SECRET_KEY || 'change-me';
const EXPIRES_MINUTES = parseInt(process.env.FILE_ACCESS_EXPIRES_MINUTES || '15', 10);

function signedUrl(filename) {
  const expires = Date.now() + EXPIRES_MINUTES * 60 * 1000;
  const token = crypto.createHmac('sha256', SECRET_KEY).update(`${filename}:${expires}`).digest('hex');
  return `${PUBLIC_BASE_URL}/recorder-api/download/${encodeURIComponent(filename)}?token=${token}&expires=${expires}`;
}

async function firefliesQuery(query, variables) {
  const res = await fetch('https://api.fireflies.ai/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${FIREFLIES_API_KEY}` },
    body: JSON.stringify({ query, variables }),
    timeout: 60000
  });
  return res.json();
}

async function waitForTranscriptByTitle(title, maxAttempts = 15, delay = 15000) {
  for (let i = 1; i <= maxAttempts; i++) {
    await new Promise(r => setTimeout(r, delay));
    console.log(`[fireflies] Polling by title (attempt ${i}/${maxAttempts})...`);
    try {
      const res = await firefliesQuery(`
        query ($title: String) {
          transcripts(title: $title, limit: 10) {
            id
            title
            duration
            date
            host_email
            organizer_email
          }
        }
      `, { title });

      if (res.errors) {
        console.log('[fireflies] Poll error:', JSON.stringify(res.errors));
        continue;
      }
      const list = (res.data && res.data.transcripts) || [];
      console.log(`[fireflies] Found ${list.length} transcripts matching title`);

      if (list.length > 0) {
        // Берём самый свежий (обычно первый)
        return list[0];
      }
    } catch (e) {
      console.log('[fireflies] Poll network error:', e.message);
    }
  }
  return null;
}

async function uploadToFireflies(filePath, roomName) {
  if (!FIREFLIES_ENABLED) { console.log('[fireflies] Disabled, skipping'); return null; }
  if (!FIREFLIES_API_KEY) { console.warn('[fireflies] No API key, skipping'); return null; }
  if (!fs.existsSync(filePath)) { console.error('[fireflies] File not found:', filePath); return { success: false, error: 'file_not_found' }; }

  const filename = path.basename(filePath);
  const fileUrl = signedUrl(filename);
  const size = fs.statSync(filePath).size;
  const expiresAt = new Date(Date.now() + EXPIRES_MINUTES * 60 * 1000).toISOString();

  // Уникальный title для поиска
  const uploadDate = new Date();
  const title = `${roomName} ${uploadDate.toISOString().replace('T', ' ').slice(0, 19)}`;

  console.log(`[fireflies] Preparing upload for room ${roomName}`);
  console.log(`[fireflies] File: ${filename} (${(size/1024).toFixed(1)} KB)`);
  console.log(`[fireflies] Title: ${title}`);
  console.log(`[fireflies] Signed URL: ${fileUrl}`);
  console.log(`[fireflies] URL expires: ${expiresAt}`);

  // Self-check: подписанный URL должен быть доступен
  try {
    const head = await fetch(fileUrl, { method: 'HEAD', timeout: 10000 });
    console.log(`[fireflies] Self-check HEAD -> HTTP ${head.status}`);
    if (head.status !== 200) {
      console.error('[fireflies] Signed URL unreachable!');
      return { success: false, error: 'signed_url_unreachable' };
    }
  } catch (e) {
    console.warn('[fireflies] Self-check failed:', e.message);
  }

  // Шаг 1: загрузить файл
  const uploadRes = await firefliesQuery(`
    mutation ($input: AudioUploadInput!) {
      uploadAudio(input: $input) {
        success
        title
        message
      }
    }
  `, {
    input: {
      url: fileUrl,
      title: title,
      custom_language: 'ru'
    }
  });

  console.log('[fireflies] Upload response:', JSON.stringify(uploadRes, null, 2));

  if (uploadRes.errors) {
    console.error('[fireflies] Upload errors:', JSON.stringify(uploadRes.errors));
    return { success: false, error: uploadRes.errors };
  }

  const upload = uploadRes.data && uploadRes.data.uploadAudio;
  if (!upload || !upload.success) {
    console.error('[fireflies] Upload not successful:', upload && upload.message);
    return { success: false, error: upload ? upload.message : 'unknown' };
  }

  console.log('[fireflies] Upload accepted. Waiting for Fireflies to process...');

  // Шаг 2: ждём появления транскрипта (ищем по title)
  const transcript = await waitForTranscriptByTitle(title);
  if (!transcript) {
    console.warn('[fireflies] Transcript not found after polling. Check Fireflies dashboard manually.');
    return { success: true, id: null, message: 'uploaded_but_id_not_found', title };
  }

  const url = `https://app.fireflies.ai/transcripts/${transcript.id}`;
  console.log(`[fireflies] Transcript found!`);
  console.log(`[fireflies]   ID: ${transcript.id}`);
  console.log(`[fireflies]   Title: ${transcript.title}`);
  console.log(`[fireflies]   URL: ${url}`);

  if (process.env.DELETE_AFTER_UPLOAD === 'true') {
    try {
      fs.unlinkSync(filePath);
      console.log(`[fireflies] Deleted local file: ${filePath}`);
    } catch (e) { console.error('[fireflies] Failed to delete:', e.message); }
  }

  return { success: true, id: transcript.id, url, title };
}

module.exports = { uploadToFireflies };
