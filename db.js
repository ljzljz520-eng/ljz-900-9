// 轻量 JSON 存储层（原子写入，防并发损坏）
const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, 'data', 'db.json');

const DEFAULT_DATA = {
  stores: [
    { id: 1, name: '人民路店', code: 'store-rml' },
    { id: 2, name: '中山大道店', code: 'store-zsd' },
    { id: 3, name: '高新区店', code: 'store-gxq' }
  ],
  issues: [],
  seq: { store: 3, issue: 0 }
};

let cache = null;

function load() {
  if (cache) return cache;
  try {
    cache = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (e) {
    cache = JSON.parse(JSON.stringify(DEFAULT_DATA));
    save();
  }
  return cache;
}

function save() {
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(cache, null, 2));
  fs.renameSync(tmp, DATA_FILE); // 原子替换
}

function nextId(kind) {
  const db = load();
  db.seq[kind] = (db.seq[kind] || 0) + 1;
  return db.seq[kind];
}

module.exports = {
  get: load,
  save,
  nextId
};
