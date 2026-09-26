'use strict';

const path = require('path');
const fs = require('fs');
const AudioMixer = require('./AudioMixer');
const createFfmpegWriter = require('./ffmpegWriter');
const { uploadToFireflies } = require('./fireflies');

const AUTO_STOP_DELAY_MS = Number(process.env.AUTO_STOP_DELAY_MS || 10000);
const OUTPUT_FORMAT = process.env.OUTPUT_FORMAT || 'webm';

class RecorderSession {
  constructor({ roomName, JitsiMeetJS, wrtc, outputDir, jitsiOptions, displayName, onStopped }) {
    this.roomName = roomName;
    this.JitsiMeetJS = JitsiMeetJS;
    this.wrtc = wrtc;
    this.jitsiOptions = jitsiOptions;
    this.displayName = displayName || 'recorder-bot';
    this.onStopped = onStopped;
    const tz = Number(process.env.TZ_OFFSET_H || 3); // UTC+3 по умолчанию
    const stamp = new Date(Date.now() + tz * 3600 * 1000).toISOString()
      .replace('T', '_')
      .replace(/\.\d+Z$/, '')
      .replace(/:/g, '-');
    this.outputPath = path.join(outputDir, `${roomName}-${stamp}.${createFfmpegWriter.extFor(OUTPUT_FORMAT)}`);
    this.sinks = new Map();
    this.stopped = false;
    this.hadParticipants = false;
    this._autoStopTimer = null;

    this.mixer = new AudioMixer({
      sampleRate: 48000,
      onFrame: (buf) => {
        if (this.ffmpeg && this.ffmpeg.stdin.writable) {
          this.ffmpeg.stdin.write(buf);
        }
      }
    });
  }

  async start() {
    fs.mkdirSync(path.dirname(this.outputPath), { recursive: true });
    this.ffmpeg = createFfmpegWriter(this.outputPath, { format: OUTPUT_FORMAT });
    this.mixer.start();

    const { JitsiMeetJS, wrtc } = this;

    this.connection = new JitsiMeetJS.JitsiConnection(null, null, this.jitsiOptions);

    await new Promise((resolve, reject) => {
      const onEstablished = () => { cleanup(); resolve(); };
      const onFailed = (err) => { cleanup(); reject(new Error(`XMPP connection failed: ${err}`)); };
      const cleanup = () => {
        this.connection.removeEventListener(JitsiMeetJS.events.connection.CONNECTION_ESTABLISHED, onEstablished);
        this.connection.removeEventListener(JitsiMeetJS.events.connection.CONNECTION_FAILED, onFailed);
      };
      this.connection.addEventListener(JitsiMeetJS.events.connection.CONNECTION_ESTABLISHED, onEstablished);
      this.connection.addEventListener(JitsiMeetJS.events.connection.CONNECTION_FAILED, onFailed);
      this.connection.connect({
        id: process.env.XMPP_USER + '@' + (process.env.XMPP_DOMAIN || 'meet.jitsi'),
        password: process.env.XMPP_PASSWORD
      });
    });

    this.room = this.connection.initJitsiConference(this.roomName.toLowerCase(), {
      openBridgeChannel: true,
      p2p: { enabled: false }
    });

    this.room.setDisplayName(this.displayName);

    this.room.on(JitsiMeetJS.events.conference.TRACK_ADDED, (track) => {
      if (track.isLocal() || track.getType() !== 'audio') return;
      const pid = track.getParticipantId();
      const mediaStreamTrack = track.getTrack();
      if (!mediaStreamTrack) return;

      const sink = new wrtc.nonstandard.RTCAudioSink(mediaStreamTrack);
      this.mixer.addParticipant(pid);
      sink.ondata = (data) => this.mixer.pushSamples(pid, data.samples);
      this.sinks.set(pid, sink);
    });

    this.room.on(JitsiMeetJS.events.conference.TRACK_REMOVED, (track) => {
      if (track.isLocal() || track.getType() !== 'audio') return;
      const pid = track.getParticipantId();
      const sink = this.sinks.get(pid);
      if (sink) {
        sink.stop();
        this.sinks.delete(pid);
      }
      this.mixer.removeParticipant(pid);
    });

    this.room.on(JitsiMeetJS.events.conference.CONFERENCE_JOINED, () => {
      if (typeof this.room.setReceiverVideoConstraint === 'function') {
        this.room.setReceiverVideoConstraint(0);
      }
    });

    // === AUTO-STOP: все участники вышли ===
    this.room.on(JitsiMeetJS.events.conference.USER_JOINED, () => {
      this.hadParticipants = true;
      this._cancelAutoStop();
    });

    this.room.on(JitsiMeetJS.events.conference.USER_LEFT, () => {
      this._maybeScheduleAutoStop();
    });

    this.room.join();
  }

  _maybeScheduleAutoStop() {
    if (this.stopped || !this.hadParticipants) return;   // не стопим, если комната была пустой с начала
    if (this.room.getParticipants().length > 0) return;  // кто-то ещё остался
    if (this._autoStopTimer) return;

    console.log(`[session:${this.roomName}] room is empty, auto-stop in ${AUTO_STOP_DELAY_MS / 1000}s`);
    this._autoStopTimer = setTimeout(async () => {
      this._autoStopTimer = null;
      if (this.stopped) return;
      if (this.room.getParticipants().length > 0) return; // кто-то вернулся за время паузы
      console.log(`[session:${this.roomName}] auto-stop: all participants left`);
      try {
        await this.stop();
      } catch (e) {
        console.error(`[session:${this.roomName}] auto-stop error: ${e.message}`);
      }
    }, AUTO_STOP_DELAY_MS);
  }

  _cancelAutoStop() {
    if (this._autoStopTimer) {
      clearTimeout(this._autoStopTimer);
      this._autoStopTimer = null;
    }
  }

  async stop() {
    if (this.stopped) return this.outputPath;
    this.stopped = true;
    this._cancelAutoStop();

    for (const sink of this.sinks.values()) sink.stop();
    this.sinks.clear();
    this.mixer.stop();

    if (this.room) {
      try { await this.room.leave(); } catch (_) { /* best-effort */ }
    }
    if (this.connection) {
      try { this.connection.disconnect(); } catch (_) { /* best-effort */ }
    }
    if (this.ffmpeg) {
      this.ffmpeg.stdin.end();
      await new Promise((resolve) => this.ffmpeg.once('close', resolve));
    }

    // Upload to Fireflies (async, non-blocking)
    if (process.env.FIREFLIES_ENABLED === 'true') {
      uploadToFireflies(this.outputPath, this.roomName).catch((err) => {
        console.error('[fireflies] Background upload failed:', err.message);
      });
    }

    if (this.onStopped) this.onStopped(this.outputPath);
    return this.outputPath;
  }
}

module.exports = RecorderSession;
