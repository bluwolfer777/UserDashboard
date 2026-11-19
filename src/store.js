'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('./config');

const settingsFile = path.join(config.dataDir, 'settings.json');
const uploadsDir = path.join(config.dataDir, 'uploads');

const DEFAULTS = {
  title: config.siteTitle,
  subtitle: '',
  textColor: 'light', // 'light' | 'dark'
  background: {
    type: 'gradient', // 'color' | 'gradient' | 'image'
    color: '#1e293b',
    gradientFrom: '#0f172a',
    gradientTo: '#1d4ed8',
    gradientAngle: 135,
    image: '',
    overlay: 0.25, // 0..0.9 dark overlay on top of the background image
    blur: 0,
  },
  links: [],
};

let state = null;

function ensureDirs() {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

function load() {
  ensureDirs();
  if (fs.existsSync(settingsFile)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
      state = {
        ...DEFAULTS,
        ...parsed,
        background: { ...DEFAULTS.background, ...(parsed.background || {}) },
        links: Array.isArray(parsed.links) ? parsed.links : [],
      };
      return state;
    } catch (err) {
      console.error(`[store] Cannot parse ${settingsFile}: ${err.message}. Using defaults.`);
    }
  }
  state = JSON.parse(JSON.stringify(DEFAULTS));
  save();
  return state;
}

function save() {
  const tmp = settingsFile + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, settingsFile);
}

function get() {
  return state || load();
}

function newId() {
  return crypto.randomBytes(8).toString('hex');
}

// Removes an uploaded file if no setting references it anymore.
function cleanupUpload(fileUrl) {
  if (!fileUrl || !fileUrl.startsWith('/uploads/')) return;
  const s = get();
  const stillUsed =
    s.background.image === fileUrl || s.links.some((l) => l.icon === fileUrl);
  if (stillUsed) return;
  const filePath = path.join(uploadsDir, path.basename(fileUrl));
  fs.promises.unlink(filePath).catch(() => {});
}

module.exports = { load, save, get, newId, cleanupUpload, uploadsDir, DEFAULTS };
