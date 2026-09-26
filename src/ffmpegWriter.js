'use strict';

const { spawn } = require('child_process');

const FORMATS = {
  webm: { ext: 'webm', codec: ['-c:a', 'libopus', '-b:a', '32k'] },
  ogg:  { ext: 'ogg',  codec: ['-c:a', 'libopus', '-b:a', '32k'] },
  mp3:  { ext: 'mp3',  codec: ['-c:a', 'libmp3lame', '-b:a', '48k'] },
  m4a:  { ext: 'm4a',  codec: ['-c:a', 'aac', '-b:a', '48k'] },
  mp4:  { ext: 'mp4',  codec: ['-c:a', 'aac', '-b:a', '48k'] },
  wav:  { ext: 'wav',  codec: ['-c:a', 'pcm_s16le'] }
};

function extFor(format) {
  const f = FORMATS[String(format || 'webm').toLowerCase()];
  return f ? f.ext : 'webm';
}

function createFfmpegWriter(outputPath, { sampleRate = 48000, format = 'webm' } = {}) {
  const conf = FORMATS[String(format).toLowerCase()] || FORMATS.webm;

  const ff = spawn('ffmpeg', [
    '-hide_banner',
    '-loglevel', 'error',
    '-y',
    '-f', 's16le',
    '-ar', String(sampleRate),
    '-ac', '1',
    '-i', 'pipe:0',
    ...conf.codec,
    outputPath
  ]);

  ff.stderr.on('data', (d) => process.stderr.write(`[ffmpeg] ${d}`));
  ff.on('error', (err) => console.error(`[ffmpeg] spawn error: ${err.message}`));

  return ff;
}

module.exports = createFfmpegWriter;
module.exports.extFor = extFor;
