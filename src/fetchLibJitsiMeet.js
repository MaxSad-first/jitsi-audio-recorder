'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

/**
 * Fetches libs/lib-jitsi-meet.min.js from the target Jitsi deployment itself
 * (not from npm/CDN). Using the bundle served by the same server you're
 * connecting to avoids Jingle/Colibri protocol mismatches between the bot
 * and your Jicofo/JVB version.
 */
async function fetchLibJitsiMeet(baseUrl, cachePath) {
  if (fs.existsSync(cachePath)) {
    return cachePath;
  }

  const url = `${baseUrl.replace(/\/$/, '')}/libs/lib-jitsi-meet.min.js`;
  fs.mkdirSync(path.dirname(cachePath), { recursive: true });

  await new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    client
      .get(url, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`Failed to fetch ${url}: HTTP ${res.statusCode}`));
          return;
        }
        const file = fs.createWriteStream(cachePath);
        res.pipe(file);
        file.on('finish', () => file.close(resolve));
        file.on('error', reject);
      })
      .on('error', reject);
  });

  return cachePath;
}

module.exports = fetchLibJitsiMeet;
