const express = require('express');
const multer = require('multer');
const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs');
const store = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const CATEGORIES = ['药品陈列', '冷藏柜', '处方区'];

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ---------- 图片上传 ----------
const storage = multer.diskStorage({
  destination: UPLOAD_DIR,
  filename: (req, file, cb) => {
    const ext = (path.extname(file.originalname) || '.jpg').toLowerCase();
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/^image\//.test(file.mimetype)) cb(null, true);
    else cb(new Error('仅支持图片文件'));
  }
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOAD_DIR));

// ---------- 工具 ----------
function deleteFile(relPath) {
  if (!relPath) return;
  const abs = path.join(__dirname, relPath);
  if (abs.startsWith(UPLOAD_DIR) && fs.existsSync(abs)) fs.unlinkSync(abs);
}

// 编号连续：基于全部问题按上报时间统一排序生成序号，删除任意记录后自动重排；
// 同一问题在全店列表 / 单店筛选 / 汇总页编号始终一致。
function orderedIssues(issues) {
  return [...issues].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id - b.id);
}

function withSerial(issues, base) {
  const all = orderedIssues(base || store.get().issues);
  const map = new Map(all.map((it, i) => [it.id, { serial: i + 1, code: 'ZG-' + String(i + 1).padStart(3, '0') }]));
  return orderedIssues(issues).map(it => ({ ...it, ...(map.get(it.id) || { serial: 0, code: '-' }) }));
}

function baseUrl(req) {
  return `${req.protocol}://${req.get('host')}`;
}

// ---------- 门店 ----------
app.get('/api/stores', (req, res) => {
  res.json(store.get().stores);
});

app.post('/api/stores', (req, res) => {
  const db = store.get();
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: '门店名称不能为空' });
  if (db.stores.some(s => s.name === name)) return res.status(400).json({ error: '门店已存在' });
  const s = { id: store.nextId('store'), name, code: 'store-' + Math.random().toString(36).slice(2, 8) };
  db.stores.push(s);
  store.save();
  res.json(s);
});

app.delete('/api/stores/:id', (req, res) => {
  const db = store.get();
  const id = Number(req.params.id);
  const related = db.issues.filter(i => i.storeId === id);
  related.forEach(i => { deleteFile(i.problemImage); deleteFile(i.rectifyImage); });
  db.issues = db.issues.filter(i => i.storeId !== id);
  db.stores = db.stores.filter(s => s.id !== id);
  store.save();
  res.json({ ok: true, removed: related.length });
});

// 校验失败时清理 multer 已落盘的图片，避免残留孤儿文件
function rejectUploadedFile(req) {
  if (req.file) deleteFile('uploads/' + req.file.filename);
}

// ---------- 问题上报（督导） ----------
app.post('/api/issues', upload.single('image'), (req, res) => {
  const db = store.get();
  const { storeId, category, description, deductPoints } = req.body;
  const fail = msg => { rejectUploadedFile(req); return res.status(400).json({ error: msg }); };
  if (!req.file) return res.status(400).json({ error: '请上传问题图片' });
  if (!db.stores.some(s => s.id === Number(storeId))) return fail('门店不存在');
  if (!CATEGORIES.includes(category)) return fail('问题区域无效');
  const pts = Number(deductPoints);
  if (!Number.isFinite(pts) || pts < 0 || pts > 100) return fail('扣分须为 0-100');

  const issue = {
    id: store.nextId('issue'),
    storeId: Number(storeId),
    category,
    description: (description || '').trim(),
    deductPoints: pts,
    problemImage: 'uploads/' + req.file.filename,
    rectifyImage: null,
    status: 'pending',
    createdAt: new Date().toISOString(),
    rectifiedAt: null
  };
  db.issues.push(issue);
  store.save();
  res.json(issue);
});

// ---------- 问题列表 ----------
app.get('/api/issues', (req, res) => {
  const db = store.get();
  let list = db.issues;
  if (req.query.storeId) list = list.filter(i => i.storeId === Number(req.query.storeId));
  if (req.query.status) list = list.filter(i => i.status === req.query.status);
  res.json(withSerial(list));
});

// 店员按门店码查待整改（扫码落地页用）
app.get('/api/stores/:code/issues', (req, res) => {
  const db = store.get();
  const s = db.stores.find(x => x.code === req.params.code);
  if (!s) return res.status(404).json({ error: '门店不存在' });
  res.json({ store: s, issues: withSerial(db.issues.filter(i => i.storeId === s.id)) });
});

// ---------- 整改上传（店员扫码） ----------
app.post('/api/issues/:id/rectify', upload.single('image'), (req, res) => {
  const db = store.get();
  const issue = db.issues.find(i => i.id === Number(req.params.id));
  if (!issue) {
    rejectUploadedFile(req);
    return res.status(404).json({ error: '问题不存在' });
  }
  if (!req.file) return res.status(400).json({ error: '请上传整改图片' });
  deleteFile(issue.rectifyImage); // 覆盖旧整改图
  issue.rectifyImage = 'uploads/' + req.file.filename;
  issue.status = 'done';
  issue.rectifiedAt = new Date().toISOString();
  store.save();
  res.json(issue);
});

// ---------- 删除（编号自动重排保持连续） ----------
app.delete('/api/issues/:id', (req, res) => {
  const db = store.get();
  const id = Number(req.params.id);
  const issue = db.issues.find(i => i.id === id);
  if (!issue) return res.status(404).json({ error: '问题不存在' });
  deleteFile(issue.problemImage);
  deleteFile(issue.rectifyImage);
  db.issues = db.issues.filter(i => i.id !== id);
  store.save();
  res.json({ ok: true });
});

// ---------- 老板汇总 ----------
app.get('/api/summary', (req, res) => {
  const db = store.get();
  const byCategory = list => CATEGORIES.map(c => {
    const total = list.filter(i => i.category === c).length;
    const done = list.filter(i => i.category === c && i.status === 'done').length;
    return { category: c, total, done, completionRate: total ? Math.round(done / total * 100) : 100 };
  });
  const stores = db.stores.map(s => {
    const issues = withSerial(db.issues.filter(i => i.storeId === s.id), db.issues);
    const total = issues.length;
    const done = issues.filter(i => i.status === 'done').length;
    const deducted = issues.reduce((sum, i) => sum + i.deductPoints, 0);
    const recovered = issues.filter(i => i.status === 'done').reduce((sum, i) => sum + i.deductPoints, 0);
    return {
      store: s,
      total, done,
      completionRate: total ? Math.round(done / total * 100) : 100,
      deducted, recovered,
      byCategory: byCategory(issues),
      issues
    };
  });
  const allIssues = db.issues;
  const allTotal = allIssues.length;
  const allDone = allIssues.filter(i => i.status === 'done').length;
  res.json({
    stores,
    overall: {
      total: allTotal,
      done: allDone,
      completionRate: allTotal ? Math.round(allDone / allTotal * 100) : 100,
      deducted: stores.reduce((a, s) => a + s.deducted, 0),
      byCategory: byCategory(allIssues)
    }
  });
});

// ---------- 门店整改二维码 ----------
app.get('/api/stores/:id/qrcode', async (req, res) => {
  const db = store.get();
  const s = db.stores.find(x => x.id === Number(req.params.id));
  if (!s) return res.status(404).json({ error: '门店不存在' });
  const url = `${baseUrl(req)}/rectify.html?code=${s.code}`;
  const png = await QRCode.toBuffer(url, { width: 360, margin: 2 });
  res.type('png').send(png);
});

app.get('/api/stores/:id/rectify-url', (req, res) => {
  const db = store.get();
  const s = db.stores.find(x => x.id === Number(req.params.id));
  if (!s) return res.status(404).json({ error: '门店不存在' });
  res.json({ url: `${baseUrl(req)}/rectify.html?code=${s.code}` });
});

app.use((err, req, res, next) => {
  res.status(400).json({ error: err.message || '请求失败' });
});

app.listen(PORT, () => console.log(`药店巡检整改平台: http://localhost:${PORT}`));
