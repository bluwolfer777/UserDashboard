'use strict';

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const MemoryStore = require('memorystore')(session);
const multer = require('multer');

const config = require('./config');
const store = require('./store');
const { authenticate } = require('./auth');

store.load();

const app = express();
app.disable('x-powered-by');
if (config.trustProxy) app.set('trust proxy', 1);

// ---------- security headers ----------
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; img-src 'self' https: http: data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-ancestors 'self'; base-uri 'self'; form-action 'self'"
  );
  next();
});

app.use(express.json({ limit: '1mb' }));

app.use(
  session({
    name: 'ud.sid',
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    store: new MemoryStore({ checkPeriod: 60 * 60 * 1000 }),
    cookie: {
      httpOnly: true,
      sameSite: 'strict',
      secure: config.cookieSecure,
      maxAge: config.sessionMaxAgeMinutes * 60 * 1000,
    },
  })
);

// ---------- helpers ----------
function requireAdmin(req, res, next) {
  if (req.session && req.session.user) return next();
  return res.status(401).json({ error: 'Non autenticato' });
}

// Simple CSRF guard: state-changing API calls must carry a custom header,
// which browsers cannot send cross-origin without a CORS preflight.
function requireAjax(req, res, next) {
  if (req.get('X-Requested-With') === 'fetch') return next();
  return res.status(403).json({ error: 'Richiesta non valida' });
}

const ALLOWED_SCHEMES = ['http:', 'https:', 'ftp:', 'ftps:', 'smb:', 'rdp:', 'ssh:', 'vnc:', 'mailto:', 'tel:', 'file:'];

function sanitizeUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (!ALLOWED_SCHEMES.includes(u.protocol)) return null;
    return u.toString();
  } catch (_) {
    return null;
  }
}

function sanitizeColor(value, fallback) {
  const v = String(value || '').trim();
  return /^#[0-9a-fA-F]{6}$/.test(v) ? v : fallback;
}

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function str(value, max) {
  return String(value ?? '').trim().slice(0, max);
}

// ---------- login rate limiting ----------
const attempts = new Map(); // ip -> { count, first }
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;

function tooManyAttempts(ip) {
  const now = Date.now();
  const rec = attempts.get(ip);
  if (!rec || now - rec.first > WINDOW_MS) return false;
  return rec.count >= MAX_ATTEMPTS;
}

function recordFailure(ip) {
  const now = Date.now();
  const rec = attempts.get(ip);
  if (!rec || now - rec.first > WINDOW_MS) attempts.set(ip, { count: 1, first: now });
  else rec.count += 1;
}

setInterval(() => {
  const now = Date.now();
  for (const [ip, rec] of attempts) if (now - rec.first > WINDOW_MS) attempts.delete(ip);
}, WINDOW_MS).unref();

// ---------- uploads ----------
const IMAGE_EXT = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp', 'image/svg+xml': '.svg', 'image/x-icon': '.ico', 'image/vnd.microsoft.icon': '.ico' };

const upload = multer({
  storage: multer.diskStorage({
    destination: store.uploadsDir,
    filename: (req, file, cb) => cb(null, crypto.randomBytes(12).toString('hex') + IMAGE_EXT[file.mimetype]),
  }),
  limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => cb(null, Boolean(IMAGE_EXT[file.mimetype])),
});

app.use(
  '/uploads',
  express.static(store.uploadsDir, {
    maxAge: '7d',
    setHeaders: (res) => {
      // Uploaded SVGs must never execute scripts when opened directly.
      res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
    },
  })
);

// ---------- public API ----------
app.get('/healthz', (req, res) => res.json({ ok: true }));

app.get('/api/public', (req, res) => {
  const s = store.get();
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    title: s.title,
    subtitle: s.subtitle,
    textColor: s.textColor,
    background: s.background,
    links: s.links.map(({ id, name, url, icon, emoji, color, newTab, description }) => ({ id, name, url, icon, emoji, color, newTab, description })),
  });
});

// ---------- auth API ----------
app.post('/api/login', requireAjax, async (req, res) => {
  const ip = req.ip;
  if (tooManyAttempts(ip)) return res.status(429).json({ error: 'Troppi tentativi, riprova più tardi' });

  const { username, password } = req.body || {};
  const user = await authenticate(str(username, 256), String(password || ''));
  if (!user) {
    recordFailure(ip);
    console.warn(`[auth] Login failed for "${str(username, 256)}" from ${ip}`);
    return res.status(401).json({ error: 'Credenziali non valide o utente non autorizzato' });
  }

  attempts.delete(ip);
  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ error: 'Errore di sessione' });
    req.session.user = user;
    console.log(`[auth] ${user.username} logged in (${user.source}) from ${ip}`);
    res.json({ user });
  });
});

app.post('/api/logout', requireAjax, (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('ud.sid');
    res.json({ ok: true });
  });
});

app.get('/api/me', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    user: req.session.user || null,
    ldapEnabled: config.ldap.enabled,
    domain: config.ldap.domain || null,
  });
});

// ---------- admin API ----------
const admin = express.Router();
admin.use(requireAdmin, requireAjax);

admin.get('/settings', (req, res) => res.json(store.get()));

admin.put('/settings', (req, res) => {
  const s = store.get();
  const b = req.body || {};
  if (b.title !== undefined) s.title = str(b.title, 120);
  if (b.subtitle !== undefined) s.subtitle = str(b.subtitle, 240);
  if (b.textColor !== undefined) s.textColor = b.textColor === 'dark' ? 'dark' : 'light';
  if (b.background) {
    const bg = b.background;
    if (['color', 'gradient', 'image'].includes(bg.type)) s.background.type = bg.type;
    s.background.color = sanitizeColor(bg.color, s.background.color);
    s.background.gradientFrom = sanitizeColor(bg.gradientFrom, s.background.gradientFrom);
    s.background.gradientTo = sanitizeColor(bg.gradientTo, s.background.gradientTo);
    s.background.gradientAngle = clampNumber(bg.gradientAngle, 0, 360, s.background.gradientAngle);
    s.background.overlay = clampNumber(bg.overlay, 0, 0.9, s.background.overlay);
    s.background.blur = clampNumber(bg.blur, 0, 20, s.background.blur);
  }
  store.save();
  res.json(s);
});

admin.post('/background/image', upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Immagine non valida' });
  const s = store.get();
  const old = s.background.image;
  s.background.image = '/uploads/' + req.file.filename;
  s.background.type = 'image';
  store.save();
  store.cleanupUpload(old);
  res.json(s);
});

admin.delete('/background/image', (req, res) => {
  const s = store.get();
  const old = s.background.image;
  s.background.image = '';
  if (s.background.type === 'image') s.background.type = 'gradient';
  store.save();
  store.cleanupUpload(old);
  res.json(s);
});

function applyLinkFields(link, body, file) {
  if (body.name !== undefined) link.name = str(body.name, 80);
  if (body.description !== undefined) link.description = str(body.description, 160);
  if (body.url !== undefined) link.url = sanitizeUrl(body.url);
  if (body.newTab !== undefined) link.newTab = body.newTab === true || body.newTab === 'true';
  if (body.color !== undefined) link.color = sanitizeColor(body.color, link.color || '#2563eb');
  if (body.emoji !== undefined) link.emoji = str(body.emoji, 8);

  const oldIcon = link.icon;
  if (file) {
    link.icon = '/uploads/' + file.filename;
  } else if (body.iconUrl !== undefined) {
    const iconUrl = str(body.iconUrl, 2048);
    if (iconUrl === '') link.icon = '';
    else if (iconUrl.startsWith('/uploads/')) link.icon = iconUrl;
    else {
      const safe = sanitizeUrl(iconUrl);
      link.icon = safe && /^https?:/.test(safe) ? safe : link.icon;
    }
  }
  return oldIcon !== link.icon ? oldIcon : null;
}

admin.post('/links', upload.single('iconFile'), (req, res) => {
  const link = { id: store.newId(), name: '', description: '', url: null, icon: '', emoji: '', color: '#2563eb', newTab: true };
  applyLinkFields(link, req.body || {}, req.file);
  if (!link.name || !link.url) {
    if (req.file) store.cleanupUpload('/uploads/' + req.file.filename);
    return res.status(400).json({ error: 'Nome e URL valido sono obbligatori' });
  }
  const s = store.get();
  s.links.push(link);
  store.save();
  res.json(link);
});

admin.put('/links/order', (req, res) => {
  const ids = Array.isArray(req.body && req.body.ids) ? req.body.ids : [];
  const s = store.get();
  const byId = new Map(s.links.map((l) => [l.id, l]));
  const ordered = ids.map((id) => byId.get(id)).filter(Boolean);
  for (const l of s.links) if (!ordered.includes(l)) ordered.push(l);
  s.links = ordered;
  store.save();
  res.json(s.links);
});

admin.put('/links/:id', upload.single('iconFile'), (req, res) => {
  const s = store.get();
  const link = s.links.find((l) => l.id === req.params.id);
  if (!link) {
    if (req.file) store.cleanupUpload('/uploads/' + req.file.filename);
    return res.status(404).json({ error: 'Link non trovato' });
  }
  const backup = { ...link };
  const oldIcon = applyLinkFields(link, req.body || {}, req.file);
  if (!link.name || !link.url) {
    Object.assign(link, backup);
    if (req.file) store.cleanupUpload('/uploads/' + req.file.filename);
    return res.status(400).json({ error: 'Nome e URL valido sono obbligatori' });
  }
  store.save();
  if (oldIcon) store.cleanupUpload(oldIcon);
  res.json(link);
});

admin.delete('/links/:id', (req, res) => {
  const s = store.get();
  const idx = s.links.findIndex((l) => l.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Link non trovato' });
  const [removed] = s.links.splice(idx, 1);
  store.save();
  store.cleanupUpload(removed.icon);
  res.json({ ok: true });
});

app.use('/api/admin', admin);

// ---------- static frontend ----------
const publicDir = path.join(__dirname, '..', 'public');
app.get('/admin', (req, res) => res.sendFile(path.join(publicDir, 'admin.html')));
app.use(express.static(publicDir, { index: 'index.html', maxAge: '1h' }));

// ---------- errors ----------
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? `File troppo grande (max ${config.maxUploadMb} MB)` : err.message });
  }
  console.error(err);
  res.status(500).json({ error: 'Errore interno' });
});

app.listen(config.port, () => {
  console.log(`[server] UserDashboard listening on port ${config.port}`);
  console.log(`[server] Data directory: ${config.dataDir}`);
  if (config.ldap.enabled) {
    console.log(`[server] LDAP: ${config.ldap.url} | base: ${config.ldap.baseDn} | admin group: ${config.ldap.adminGroupDn}`);
  } else {
    console.warn('[server] LDAP not configured (set LDAP_URL and LDAP_DOMAIN or LDAP_BASE_DN)');
  }
  if (config.localAdmin.enabled) console.warn('[server] Local break-glass admin account is ENABLED');
  if (!config.ldap.enabled && !config.localAdmin.enabled) console.warn('[server] No login method configured: admin portal is unreachable');
  if (config.sessionSecretGenerated) console.warn('[server] SESSION_SECRET not set: generated a random one (sessions are lost on restart)');
});
