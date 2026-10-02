/* ============================================================
 * 存储层：业务数据存 localStorage，图片 Blob 存 IndexedDB
 * ============================================================ */
(function (global) {
  'use strict';

  var DB_NAME = 'pharm-inspect-db';
  var DB_VERSION = 1;
  var STORE_IMG = 'images';
  var LS_KEY = 'pharm-inspect-state-v1';

  /* ---------- IndexedDB ---------- */
  var dbPromise = null;
  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function (e) {
        var db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_IMG)) {
          db.createObjectStore(STORE_IMG); // key = imageId
        }
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
    return dbPromise;
  }
  function tx(mode) {
    return openDB().then(function (db) {
      return db.transaction(STORE_IMG, mode).objectStore(STORE_IMG);
    });
  }
  function idbReq(req) {
    return new Promise(function (resolve, reject) {
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }
  function putImage(id, blob) {
    return tx('readwrite').then(function (s) { return idbReq(s.put(blob, id)); });
  }
  function getImage(id) {
    return tx('readonly').then(function (s) { return idbReq(s.get(id)); });
  }
  function deleteImage(id) {
    return tx('readwrite').then(function (s) { return idbReq(s.delete(id)); });
  }
  function allImageIds() {
    return tx('readonly').then(function (s) { return idbReq(s.getAllKeys()); });
  }
  function clearImages() {
    return tx('readwrite').then(function (s) { return idbReq(s.clear()); });
  }

  /* ---------- state ---------- */
  function defaultState() {
    return {
      stores: [],     // {id, name, code, address}
      batches: [],    // {id, storeId, inspector, createdAt, closed, items:[...]}
      seq: { store: 0, batch: 0 }
    };
  }
  function loadState() {
    try {
      var raw = localStorage.getItem(LS_KEY);
      if (!raw) return defaultState();
      var s = JSON.parse(raw);
      if (!s.stores || !s.batches) return defaultState();
      s.seq = s.seq || { store: 0, batch: 0 };
      return s;
    } catch (e) {
      return defaultState();
    }
  }
  function saveState() {
    localStorage.setItem(LS_KEY, JSON.stringify(state));
  }

  var state = loadState();

  /* ---------- 图片工具 ---------- */
  var urlCache = {};
  function objectUrl(id) {
    if (!id) return Promise.resolve('');
    if (urlCache[id]) return Promise.resolve(urlCache[id]);
    return getImage(id).then(function (blob) {
      if (!blob) return '';
      var u = URL.createObjectURL(blob);
      urlCache[id] = u;
      return u;
    });
  }
  function revokeUrl(id) {
    if (urlCache[id]) { URL.revokeObjectURL(urlCache[id]); delete urlCache[id]; }
  }

  /** 读取文件 → 压缩 → 存入 IDB，返回 imageId */
  function ingestImage(file, maxSize) {
    maxSize = maxSize || 1280;
    return new Promise(function (resolve, reject) {
      if (!file || !/^image\//.test(file.type)) { reject(new Error('请选择图片文件')); return; }
      var reader = new FileReader();
      reader.onload = function (e) {
        var img = new Image();
        img.onload = function () {
          var w = img.width, h = img.height;
          var scale = Math.min(1, maxSize / Math.max(w, h));
          var cw = Math.round(w * scale), ch = Math.round(h * scale);
          var canvas = document.createElement('canvas');
          canvas.width = cw; canvas.height = ch;
          var ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, cw, ch);
          canvas.toBlob(function (blob) {
            if (!blob) { reject(new Error('图片处理失败')); return; }
            var id = uid('img');
            putImage(id, blob).then(function () { resolve(id); }).catch(reject);
          }, 'image/jpeg', 0.82);
        };
        img.onerror = function () { reject(new Error('图片读取失败')); };
        img.src = e.target.result;
      };
      reader.onerror = function () { reject(new Error('文件读取失败')); };
      reader.readAsDataURL(file);
    });
  }

  /** canvas → blob → 存 IDB */
  function ingestCanvas(canvas) {
    return new Promise(function (resolve, reject) {
      canvas.toBlob(function (blob) {
        var id = uid('img');
        putImage(id, blob).then(function () { resolve(id); }).catch(reject);
      }, 'image/jpeg', 0.82);
    });
  }

  function uid(prefix) {
    return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  /* ---------- 业务操作 ---------- */
  function addStore(data) {
    state.seq.store++;
    var store = {
      id: uid('store'),
      seq: state.seq.store,
      name: data.name,
      code: data.code || ('D' + String(state.seq.store).padStart(3, '0')),
      address: data.address || ''
    };
    state.stores.push(store);
    saveState();
    return store;
  }
  function removeStore(id) {
    var batches = state.batches.filter(function (b) { return b.storeId === id; });
    batches.forEach(removeBatchInternal);
    state.stores = state.stores.filter(function (s) { return s.id !== id; });
    saveState();
  }
  function addBatch(data) {
    state.seq.batch++;
    var batch = {
      id: uid('batch'),
      no: state.seq.batch,
      storeId: data.storeId,
      inspector: data.inspector || '',
      createdAt: Date.now(),
      closed: false,
      items: []
    };
    state.batches.unshift(batch);
    saveState();
    return batch;
  }
  function getBatch(id) {
    return state.batches.find(function (b) { return b.id === id; });
  }
  function removeBatchInternal(batch) {
    if (!batch) return;
    batch.items.forEach(function (it) {
      (it.photos || []).forEach(function (p) {
        if (p.imageId) { revokeUrl(p.imageId); deleteImage(p.imageId); }
      });
      (it.fixes || []).forEach(function (f) {
        if (f.imageId) { revokeUrl(f.imageId); deleteImage(f.imageId); }
      });
    });
  }
  function removeBatch(id) {
    var b = getBatch(id);
    removeBatchInternal(b);
    state.batches = state.batches.filter(function (x) { return x.id !== id; });
    saveState();
  }
  function setBatchClosed(id, closed) {
    var b = getBatch(id);
    if (b) { b.closed = !!closed; saveState(); }
  }

  function addItem(batchId, data) {
    var b = getBatch(batchId);
    if (!b) return null;
    var item = {
      id: uid('item'),
      cat: data.cat,                       // display | fridge | rx | other
      title: data.title || '',
      desc: data.desc || '',
      points: Number(data.points) || 0,
      photos: data.photos || [],           // [{imageId}]
      fixes: [],                            // [{imageId, by, at}]
      createdAt: Date.now()
    };
    b.items.push(item);
    saveState();
    return item;
  }
  function updateItem(batchId, itemId, patch) {
    var b = getBatch(batchId);
    var it = b && b.items.find(function (x) { return x.id === itemId; });
    if (!it) return;
    if (patch.cat !== undefined) it.cat = patch.cat;
    if (patch.title !== undefined) it.title = patch.title;
    if (patch.desc !== undefined) it.desc = patch.desc;
    if (patch.points !== undefined) it.points = Number(patch.points) || 0;
    saveState();
  }
  function removeItem(batchId, itemId) {
    var b = getBatch(batchId);
    if (!b) return;
    var it = b.items.find(function (x) { return x.id === itemId; });
    if (!it) return;
    it.photos.forEach(function (p) { if (p.imageId) { revokeUrl(p.imageId); deleteImage(p.imageId); } });
    it.fixes.forEach(function (f) { if (f.imageId) { revokeUrl(f.imageId); deleteImage(f.imageId); } });
    b.items = b.items.filter(function (x) { return x.id !== itemId; });
    saveState();
  }
  /** 删除某张问题图 —— 渲染时编号按剩余图片顺序自动连续 */
  function removeProblemPhoto(batchId, itemId, photoRef) {
    var b = getBatch(batchId);
    var it = b && b.items.find(function (x) { return x.id === itemId; });
    if (!it) return;
    var idx = it.photos.indexOf(photoRef);
    if (idx >= 0) {
      var removed = it.photos.splice(idx, 1)[0];
      if (removed.imageId) { revokeUrl(removed.imageId); deleteImage(removed.imageId); }
      // 对应位置的整改图一并移除，保证问题/整改成对
      var fix = it.fixes[idx];
      if (fix && fix.imageId) { revokeUrl(fix.imageId); deleteImage(fix.imageId); }
      it.fixes.splice(idx, 1);
      saveState();
    }
  }
  function appendProblemPhoto(batchId, itemId, imageId) {
    var b = getBatch(batchId);
    var it = b && b.items.find(function (x) { return x.id === itemId; });
    if (it) { it.photos.push({ imageId: imageId }); it.fixes.push(null); saveState(); }
  }
  /** 设置第 idx 张问题图对应的整改图（重传即替换） */
  function setFix(batchId, itemId, idx, imageId, by) {
    var b = getBatch(batchId);
    var it = b && b.items.find(function (x) { return x.id === itemId; });
    if (!it) return;
    while (it.fixes.length < it.photos.length) it.fixes.push(null);
    var old = it.fixes[idx];
    if (old && old.imageId) { revokeUrl(old.imageId); deleteImage(old.imageId); }
    it.fixes[idx] = { imageId: imageId, by: by || '', at: Date.now() };
    saveState();
  }
  function clearFix(batchId, itemId, idx) {
    var b = getBatch(batchId);
    var it = b && b.items.find(function (x) { return x.id === itemId; });
    if (!it || !it.fixes[idx]) return;
    var old = it.fixes[idx];
    if (old.imageId) { revokeUrl(old.imageId); deleteImage(old.imageId); }
    it.fixes[idx] = null;
    saveState();
  }

  /** 清理未被任何记录引用的孤儿图片（启动时调用一次） */
  function gcImages() {
    var referenced = {};
    state.batches.forEach(function (b) {
      b.items.forEach(function (it) {
        (it.photos || []).forEach(function (p) { if (p && p.imageId) referenced[p.imageId] = 1; });
        (it.fixes || []).forEach(function (f) { if (f && f.imageId) referenced[f.imageId] = 1; });
      });
    });
    return allImageIds().then(function (keys) {
      var jobs = keys.filter(function (k) { return !referenced[k]; }).map(function (k) {
        revokeUrl(k);
        return deleteImage(k);
      });
      return Promise.all(jobs);
    }).catch(function () {});
  }

  function resetAll() {
    localStorage.removeItem(LS_KEY);
    var prev = Object.keys(urlCache);
    prev.forEach(revokeUrl);
    state = loadState();
    api.state = state;
    return clearImages();
  }

  var api = {
    state: state,
    save: saveState,
    reload: function () { state = loadState(); return state; },
    uid: uid,
    ingestImage: ingestImage,
    ingestCanvas: ingestCanvas,
    objectUrl: objectUrl,
    revokeUrl: revokeUrl,
    allImageIds: allImageIds,
    addStore: addStore, removeStore: removeStore,
    addBatch: addBatch, getBatch: getBatch, removeBatch: removeBatch, setBatchClosed: setBatchClosed,
    addItem: addItem, updateItem: updateItem, removeItem: removeItem,
    removeProblemPhoto: removeProblemPhoto, appendProblemPhoto: appendProblemPhoto,
    setFix: setFix, clearFix: clearFix,
    gcImages: gcImages, resetAll: resetAll
  };
  global.Storage = api;
})(window);
