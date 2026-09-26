'use strict';

const XMLHttpRequest = require("xhr2");
const cssSelect = require("css-select");
const wrtc = require('@roamhq/wrtc');
const WebSocket = require('ws');
const { JSDOM } = require('jsdom');

// === DOM Setup ===
const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
  url: 'https://recorder.invalid/',
  pretendToBeVisual: true
});

global.window = dom.window;
global.document = dom.window.document;
global.navigator = dom.window.navigator;
global.location = dom.window.location;
global.localStorage = dom.window.localStorage;
global.DOMParser = dom.window.DOMParser;
global.XMLSerializer = dom.window.XMLSerializer;
global.XMLHttpRequest = XMLHttpRequest;
global.self = global.window;

// === querySelectorAll polyfill for xmldom nodes ===
// Strophe uses @xmldom/xmldom internally, those nodes don't have querySelectorAll
function patchQSA(node) {
  if (!node || typeof node !== 'object' || node._qsaPatched) return node;
  node._qsaPatched = true;

  if (!node.querySelectorAll) {
    node.querySelectorAll = function(selector) {
      try {
        const clean = selector.replace(/:scope\s*>?\s*/g, '');
        // Simple implementation: split by > and traverse
        const parts = clean.split('>').map(s => s.trim()).filter(Boolean);
        if (parts.length === 0) return [];

        let current = [node];
        for (const part of parts) {
          const tagMatch = part.match(/^(\w+|\*)(?:\[(.+?)\])?$/);
          if (!tagMatch) return [];
          const [, tag, attrFilter] = tagMatch;
          const next = [];
          for (const n of current) {
            if (!n.getElementsByTagName) continue;
            const found = n.getElementsByTagName(tag);
            for (let i = 0; i < found.length; i++) {
              if (attrFilter) {
                const am = attrFilter.match(/^([^=]+)(?:=["']?([^"']*)["']?)?$/);
                if (am) {
                  const val = found[i].getAttribute ? found[i].getAttribute(am[1]) : null;
                  if (am[2] !== undefined && val !== am[2]) continue;
                  if (am[2] === undefined && val === null) continue;
                }
              }
              next.push(found[i]);
            }
          }
          current = next;
        }
        return current;
      } catch (e) {
        try { return cssSelect.selectAll(selector.replace(/:scope\s*>?\s*/g, ''), node); }
        catch (_) { return []; }
      }
    };
  }

  if (!node.querySelector) {
    node.querySelector = function(sel) {
      const r = node.querySelectorAll(sel);
      return r && r.length > 0 ? r[0] : null;
    };
  }
  return node;
}

// Patch DOMParser to add querySelectorAll to parsed documents
const OrigDOMParser = global.DOMParser;
global.DOMParser = class extends OrigDOMParser {
  parseFromString(...args) {
    const doc = super.parseFromString(...args);
    patchQSA(doc);
    if (doc.documentElement) patchQSA(doc.documentElement);
    // Patch all children recursively via a simple walk
    const walk = (n) => {
      patchQSA(n);
      if (n.childNodes) {
        for (let i = 0; i < n.childNodes.length; i++) walk(n.childNodes[i]);
      }
    };
    walk(doc);
    return doc;
  }
};

// === navigator.mediaDevices stub ===
Object.defineProperty(global.navigator, 'mediaDevices', {
  value: {
    enumerateDevices: async () => [],
    getUserMedia: async () => { throw new Error('This bot never publishes local audio/video.'); }
  },
  configurable: true
});

global.WebSocket = WebSocket;
global.screen = dom.window.screen;

// === WebRTC globals ===
global.RTCPeerConnection = wrtc.RTCPeerConnection;
global.RTCSessionDescription = wrtc.RTCSessionDescription;
global.RTCIceCandidate = wrtc.RTCIceCandidate;
global.MediaStream = wrtc.MediaStream;
global.MediaStreamTrack = wrtc.MediaStreamTrack;

// === RTCRtpTransceiver polyfill ===
// lib-jitsi-meet checks: 'setCodecPreferences' in window.RTCRtpTransceiver.prototype
class FakeRTCRtpTransceiver {
  constructor() {
    this.direction = 'inactive';
    this.currentDirection = null;
    this.mid = null;
    this.sender = { track: null, replaceTrack: async () => {} };
    this.receiver = { track: null };
  }
  setCodecPreferences() {}
  getHeaderExtensionsToNegotiate() { return []; }
  getNegotiatedHeaderExtensions() { return []; }
}
// Must be on prototype for 'in' operator check
FakeRTCRtpTransceiver.prototype.setCodecPreferences = function() {};

global.RTCRtpTransceiver = FakeRTCRtpTransceiver;
global.window.RTCRtpTransceiver = FakeRTCRtpTransceiver;

class FakeRTCRtpSender {
  constructor() { this.track = null; }
  static getCapabilities() { return { codecs: [], headerExtensions: [] }; }
  async replaceTrack() {}
  async setParameters() {}
  getParameters() { return {}; }
}
global.RTCRtpSender = FakeRTCRtpSender;
global.window.RTCRtpSender = FakeRTCRtpSender;

class FakeRTCRtpReceiver {
  constructor() { this.track = null; }
  static getCapabilities() { return { codecs: [], headerExtensions: [] }; }
  getParameters() { return {}; }
}
global.RTCRtpReceiver = FakeRTCRtpReceiver;
global.window.RTCRtpReceiver = FakeRTCRtpReceiver;

// === Prevent process crash on unhandled errors ===
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception (ignored to keep bot alive):', err.message);
});
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection (ignored):', reason && reason.message ? reason.message : reason);
});

module.exports = { wrtc };
