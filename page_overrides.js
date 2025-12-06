const fs = require('fs');
const path = require('path');
const multer = require('multer');

const DATA_DIR = path.join(__dirname, '../uploads/page-overrides');
const DATA_FILE = path.join(DATA_DIR, 'overrides.json');

// Ensure directories exist
function ensureDirs() {
  try { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (_) {}
}

ensureDirs();

// Simple JSON store
function readAll() {
  try { if (!fs.existsSync(DATA_FILE)) return {}; } catch (_) { return {}; }
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8') || '{}'); } catch (_) { return {}; }
}

function writeAll(obj) {
  ensureDirs();
  fs.writeFileSync(DATA_FILE, JSON.stringify(obj, null, 2), 'utf8');
}

function getOverride(req, res) {
  const page = String(req.params.page || '').trim();
  if (!page) return res.status(400).json({ error: 'page is required' });
  const all = readAll();
  return res.json({ page, data: all[page] || null });
}

function setOverride(req, res) {
  const page = String(req.params.page || '').trim();
  if (!page) return res.status(400).json({ error: 'page is required' });
  const { bg, text1, text2, text3, slides, portfolio, finalSlides } = req.body || {};
  const all = readAll();
  if (page === 'index') {
    let current = all[page] || {};
    // slides
    if (slides) {
      let safeSlides = slides;
      if (Array.isArray(slides)) {
        safeSlides = slides.map(s => ({ bg: (s && s.bg) || '', text1: (s && s.text1) || '', text2: (s && s.text2) || '', text3: (s && s.text3) || '' }));
      } else if (typeof slides === 'object') {
        const out = {};
        Object.keys(slides).forEach(k => {
          const s = slides[k] || {};
          out[k] = { bg: s.bg || '', text1: s.text1 || '', text2: s.text2 || '', text3: s.text3 || '' };
        });
        safeSlides = out;
      }
      current = { ...current, slides: safeSlides };
    }
    // portfolio
    if (portfolio) {
      let safePortfolio = portfolio;
      if (Array.isArray(portfolio)) {
        safePortfolio = portfolio.map(p => ({ bg: (p && p.bg) || '', text1: (p && p.text1) || '', text2: (p && p.text2) || '', text3: (p && p.text3) || '' }));
      } else if (typeof portfolio === 'object') {
        const out = {};
        Object.keys(portfolio).forEach(k => {
          const p = portfolio[k] || {};
          out[k] = { bg: p.bg || '', text1: p.text1 || '', text2: p.text2 || '', text3: p.text3 || '' };
        });
        safePortfolio = out;
      }
      current = { ...current, portfolio: safePortfolio };
    }
    // final slides
    if (finalSlides) {
      let safeFinalSlides = finalSlides;
      if (Array.isArray(finalSlides)) {
        safeFinalSlides = finalSlides.map(f => ({ bg: (f && f.bg) || '', text1: (f && f.text1) || '', text2: (f && f.text2) || '', text3: (f && f.text3) || '' }));
      } else if (typeof finalSlides === 'object') {
        const out = {};
        Object.keys(finalSlides).forEach(k => {
          const f = finalSlides[k] || {};
          out[k] = { bg: f.bg || '', text1: f.text1 || '', text2: f.text2 || '', text3: f.text3 || '' };
        });
        safeFinalSlides = out;
      }
      current = { ...current, finalSlides: safeFinalSlides };
    }
    // If none of the section arrays provided, fall back to single bg/texts update
    if (!slides && !portfolio && !finalSlides) {
      current = { bg: bg || '', text1: text1 || '', text2: text2 || '', text3: text3 || '' };
    }
    all[page] = current;
  } else {
    // For all other pages, merge incoming payload with existing page data.
    // This preserves sectioned structures like about.hero/content/story/banner and services.cards
    const incoming = (req.body && typeof req.body === 'object')
      ? req.body
      : { bg: bg || '', text1: text1 || '', text2: text2 || '', text3: text3 || '' };
    all[page] = { ...(all[page] || {}), ...incoming };
  }
  writeAll(all);
  return res.json({ success: true, page, data: all[page] });
}

function clearOverride(req, res) {
  const page = String(req.params.page || '').trim();
  if (!page) return res.status(400).json({ error: 'page is required' });
  const all = readAll();
  delete all[page];
  writeAll(all);
  return res.json({ success: true });
}

// Multer storage for images
const storage = multer.diskStorage({
  destination: function(req, file, cb) {
    const imgDir = path.join(DATA_DIR, 'images');
    try { if (!fs.existsSync(imgDir)) fs.mkdirSync(imgDir, { recursive: true }); } catch (_) {}
    cb(null, imgDir);
  },
  filename: function(req, file, cb) {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const safe = Date.now() + '-' + Math.round(Math.random() * 1e9) + ext;
    cb(null, safe);
  }
});

function fileFilter(req, file, cb) {
  if (!file.mimetype || !file.mimetype.startsWith('image/')) return cb(new Error('Only image uploads allowed'));
  cb(null, true);
}

const upload = multer({ storage, fileFilter, limits: { fileSize: 15 * 1024 * 1024 } });

function uploadImageHandler(req, res) {
  // multer places file on req.file
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const relPath = '/uploads/page-overrides/images/' + req.file.filename;
  return res.json({ success: true, url: relPath });
}

module.exports = {
  getOverride,
  setOverride,
  clearOverride,
  upload,
  uploadImageHandler,
};


