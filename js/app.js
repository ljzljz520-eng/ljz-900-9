/* ============================================================
 * 连锁药店巡检整改台 —— 主应用
 * 路由：#/ 首页 · #/supervisor 督导端 · #/batch/:id 巡检批次详情
 *       #/fix?b=批次&i=条目  店员整改 · #/boss 老板汇总
 * ============================================================ */
(function () {
  'use strict';

  var S = window.Storage;

  var CATS = {
    display: { name: '药品陈列', cls: 'cat-display', icon: '陈' },
    fridge:  { name: '冷藏柜',   cls: 'cat-fridge',  icon: '冷' },
    rx:      { name: '处方药区', cls: 'cat-rx',      icon: 'Rx' },
    other:   { name: '其他',     cls: 'cat-other',   icon: '他' }
  };
  var CAT_LIST = ['display', 'fridge', 'rx', 'other'];

  /* ---------------- utils ---------------- */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function pad(n) { return String(n).padStart(2, '0'); }
  function fmtDate(ts) {
    if (!ts) return '—';
    var d = new Date(ts);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
      ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  function fmtDay(ts) {
    var d = new Date(ts);
    return (d.getMonth() + 1) + '月' + d.getDate() + '日';
  }
  function storeById(id) { return S.state.stores.find(function (x) { return x.id === id; }); }
  function batchNo(b) { return 'NO.' + String(b.no).padStart(4, '0'); }
  function itemNo(b, item) { return pad(b.items.indexOf(item) + 1); }

  /** 单条目：整改进度 = 已整改图数 / 问题图数 */
  function itemProgress(it) {
    var total = it.photos.length;
    var done = it.fixes.filter(Boolean).length;
    return { done: done, total: total, pct: total ? Math.round(done / total * 100) : 0 };
  }
  /** 批次汇总（图片口径完成率 + 扣分项） */
  function batchStats(b) {
    var photos = 0, fixed = 0, itemsDone = 0, points = 0, openPoints = 0;
    b.items.forEach(function (it) {
      var p = itemProgress(it);
      photos += p.total; fixed += p.done;
      if (p.total > 0 && p.done === p.total) itemsDone++;
      points += it.points;
      if (p.done < p.total) openPoints += it.points;
    });
    return {
      photos: photos, fixed: fixed,
      itemsTotal: b.items.length, itemsDone: itemsDone,
      pct: photos ? Math.round(fixed / photos * 100) : 0,
      points: points, openPoints: openPoints
    };
  }

  /* ---------------- toast / lightbox ---------------- */
  var toastTimer = null;
  function toast(msg) {
    var el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, 2200);
  }
  function lightbox(src) {
    var box = $('#lightbox');
    box.hidden = false;
    $('img', box).src = src;
  }
  // 全局：点击任意缩略图查看大图（排除上传组件里的删除按钮等）
  document.addEventListener('click', function (e) {
    var img = e.target.closest && e.target.closest('.thumb img, .pair-line img');
    if (img && img.src && img.complete && img.naturalWidth > 0) lightbox(img.src);
  });
  $('#lightbox').addEventListener('click', function () { this.hidden = true; });

  /* ---------------- modal ---------------- */
  function openModal(html, opts) {
    opts = opts || {};
    var root = $('#modal-root');
    root.innerHTML =
      '<div class="modal-mask">' +
        '<div class="modal ' + (opts.wide ? 'wide' : '') + '">' + html + '</div>' +
      '</div>';
    var mask = $('.modal-mask', root);
    function close() { root.innerHTML = ''; document.removeEventListener('keydown', onKey); }
    function onKey(e) { if (e.key === 'Escape') close(); }
    mask.addEventListener('mousedown', function (e) { if (e.target === mask) close(); });
    $all('.modal-close,[data-close]', root).forEach(function (b) { b.addEventListener('click', close); });
    document.addEventListener('keydown', onKey);
    return { root: root, close: close };
  }
  function confirmBox(title, msg, okText, onOk) {
    var m = openModal(
      '<div class="modal-head"><h3>' + esc(title) + '</h3><button class="modal-close">×</button></div>' +
      '<div class="modal-body"><p style="margin:0;color:#44524f">' + esc(msg) + '</p></div>' +
      '<div class="modal-foot"><button class="btn" data-close>取消</button>' +
      '<button class="btn danger" data-ok>' + esc(okText) + '</button></div>'
    );
    $('[data-ok]', m.root).addEventListener('click', function () { onOk(); m.close(); });
  }

  /* ---------------- 图片异步渲染 ---------------- */
  function hydrateImages(root) {
    $all('[data-img-id]', root).forEach(function (img) {
      if (img.dataset.loaded) return;
      var id = img.getAttribute('data-img-id');
      img.dataset.loaded = '1';
      S.objectUrl(id).then(function (url) {
        if (url) img.src = url;
        else { img.removeAttribute('data-img-id'); img.alt = '图片已失效'; }
      });
    });
  }

  /* ---------------- 上传组件（弹窗内使用，暂存 Blob） ---------------- */
  /**
   * 返回控制器 { el, files:[{blob,id?}], addFiles, onchange }
   * 初始图片可选 [{imageId}]
   */
  function uploader(initial) {
    var files = (initial || []).map(function (p) { return { imageId: p.imageId }; });
    var el = document.createElement('div');
    el.className = 'uploader';

    function render() {
      el.innerHTML = '';
      files.forEach(function (f, i) {
        var slot = document.createElement('div');
        slot.className = 'thumb';
        var img = document.createElement('img');
        img.alt = '图片 ' + (i + 1);
        if (f.imageId) img.setAttribute('data-img-id', f.imageId);
        else img.src = URL.createObjectURL(f.blob);
        img.addEventListener('click', function () { if (img.src) lightbox(img.src); });
        slot.appendChild(img);
        var seq = document.createElement('span');
        seq.className = 'seq';
        seq.textContent = '图' + (i + 1);
        slot.appendChild(seq);
        var del = document.createElement('button');
        del.className = 'del'; del.type = 'button'; del.innerHTML = '×';
        del.title = '删除后编号自动连续';
        del.addEventListener('click', function () {
          files.splice(i, 1);
          render();
        });
        slot.appendChild(del);
        el.appendChild(slot);
      });
      var add = document.createElement('label');
      add.className = 'upload-slot';
      add.innerHTML = '<span class="plus">+</span><span class="cap">拍照 / 相册</span>';
      var inp = document.createElement('input');
      inp.type = 'file'; inp.accept = 'image/*'; inp.capture = 'environment';
      inp.multiple = true;
      inp.style.display = 'none';
      inp.addEventListener('change', function () {
        var list = Array.prototype.slice.call(inp.files);
        inp.value = '';
        addFiles(list);
      });
      add.appendChild(inp);
      el.appendChild(add);
    }
    function addFiles(list) {
      var pending = list.slice();
      (function step() {
        if (!pending.length) { render(); return; }
        var f = pending.shift();
        S.ingestImage(f).then(function (id) {
          files.push({ imageId: id });
          step();
        }).catch(function (e) { toast(e.message); step(); });
      })();
      render();
    }
    render();
    return { el: el, files: files, addFiles: addFiles };
  }

  /* ---------------- 二维码 ---------------- */
  function makeQR(container, text, size) {
    container.innerHTML = '';
    new window.QRCode(container, {
      text: text, width: size || 188, height: size || 188,
      colorDark: '#15322d', colorLight: '#ffffff',
      correctLevel: window.QRCode.CorrectLevel.M
    });
  }
  function fixUrl(batchId, itemId) {
    var base = location.origin + location.pathname;
    return base + '#/fix?b=' + encodeURIComponent(batchId) +
      (itemId ? '&i=' + encodeURIComponent(itemId) : '');
  }

  /* ================================================================
   *  视图：首页
   * ================================================================ */
  function viewHome() {
    var app = $('#app');
    var has = S.state.batches.length > 0;
    app.innerHTML =
      '<div class="hero no-print"><h1>巡检问题拍照上传，店员扫码整改，老板一屏汇总</h1>' +
      '<p>督导按门店记录药品陈列、冷藏柜、处方药区问题并上传图片；店员扫描二维码上传整改照片；系统自动配对问题图与整改图，统计扣分项与整改完成率。</p></div>' +
      '<div class="role-grid">' +
        '<a class="role-card" href="#/supervisor">' +
          '<div class="role-ico" style="background:var(--teal-l);color:var(--teal-d)">摄</div>' +
          '<h3>督导端</h3><p>选择门店发起巡检，分类记录问题、上传照片、设定扣分项，生成整改二维码。</p>' +
          '<div class="arrow">进入督导端 →</div></a>' +
        '<a class="role-card" id="scan-entry">' +
          '<div class="role-ico" style="background:var(--amber-l);color:var(--amber)">码</div>' +
          '<h3>店员整改</h3><p>扫描督导提供的二维码进入整改页，按问题逐项上传整改照片，可重传替换。</p>' +
          '<div class="arrow" id="scan-link">扫码进入 →</div></a>' +
        '<a class="role-card" href="#/boss">' +
          '<div class="role-ico" style="background:var(--blue-l);color:var(--blue)">总</div>' +
          '<h3>老板汇总</h3><p>问题图 / 整改图成对浏览，查看各门店扣分与完成率，整改进度一目了然。</p>' +
          '<div class="arrow">查看汇总页 →</div></a>' +
      '</div>' +
      '<div class="card mt16 no-print"><h2>演示数据</h2>' +
        '<p class="hint" style="margin:0 0 12px">内置 3 家门店、示例巡检批次与 Canvas 绘制的问题/整改示意图，方便快速体验完整流程。</p>' +
        '<div class="row">' +
          (has ? '<span class="badge done">已载入演示数据</span>' : '<button class="btn primary" id="load-demo">载入演示数据</button>') +
          (has ? '<button class="btn danger" id="reset-demo">清空全部数据</button>' : '') +
        '</div>' +
      '</div>';

    var loadBtn = $('#load-demo', app);
    if (loadBtn) loadBtn.addEventListener('click', function () {
      var btn = this; btn.disabled = true; btn.textContent = '生成中…';
      window.DemoData.build().then(function () {
        toast('演示数据已生成');
        viewHome();
      }).catch(function (e) {
        btn.disabled = false; btn.textContent = '载入演示数据';
        toast('生成失败：' + (e && e.message || e));
      });
    });
    var resetBtn = $('#reset-demo', app);
    if (resetBtn) resetBtn.addEventListener('click', function () {
      confirmBox('清空全部数据', '将删除所有门店、巡检批次及全部图片，且无法恢复。', '确认清空', function () {
        S.resetAll().then(function () { toast('已清空'); viewHome(); });
      });
    });
    $('#scan-entry', app).addEventListener('click', function (e) {
      e.preventDefault();
      var open = S.state.batches.filter(function (b) { return !b.closed; });
      if (!open.length) {
        toast(S.state.batches.length ? '暂无进行中的巡检批次' : '请先由督导端发起巡检');
        if (!S.state.batches.length) location.hash = '#/supervisor';
        return;
      }
      // 手机上由扫码进入；这里模拟扫码，直接进入最近一个进行中批次
      var b = open[0];
      location.hash = '#/fix?b=' + b.id;
    });
  }

  /* ================================================================
   *  视图：督导端（门店 + 批次列表）
   * ================================================================ */
  function viewSupervisor() {
    var app = $('#app');
    app.innerHTML =
      '<div class="page-head"><div><h1>督导端 · 巡检管理</h1>' +
      '<p class="sub">按门店发起巡检，上传药品陈列 / 冷藏柜 / 处方药区问题图片</p></div>' +
      '<div class="row"><button class="btn" id="manage-stores">门店管理</button>' +
      '<button class="btn primary" id="new-batch">＋ 发起巡检</button></div></div>' +
      '<div id="batch-list"></div>';

    $('#new-batch', app).addEventListener('click', openBatchModal);
    $('#manage-stores', app).addEventListener('click', openStoresModal);

    var list = $('#batch-list', app);
    if (!S.state.batches.length) {
      list.innerHTML = '<div class="card empty"><div class="big">▤</div>还没有巡检批次<br><span class="hint">点击「发起巡检」开始第一次门店巡检</span></div>';
      return;
    }
    list.innerHTML = S.state.batches.map(function (b) {
      var st = storeById(b.storeId);
      var stt = batchStats(b);
      var status = b.closed ? '<span class="badge closed">已归档</span>'
        : (stt.pct === 100 ? '<span class="badge done">整改完成</span>' : '<span class="badge open">整改中</span>');
      return '<div class="card batch-card"><div class="batch-main">' +
        '<div class="store-avatar">' + esc((st && st.name.slice(-2)) || '门店') + '</div>' +
        '<div class="batch-meta">' +
          '<div class="t"><a href="#/batch/' + b.id + '">' + esc(st ? st.name : '（已删除门店）') + '</a> ' +
            '<span class="muted" style="font-size:12px">' + batchNo(b) + '</span></div>' +
          '<div class="m">督导：' + esc(b.inspector || '—') + ' · ' + fmtDate(b.createdAt) + '</div>' +
          '<div class="progress"><i style="width:' + stt.pct + '%"></i></div>' +
        '</div>' +
        '<div style="text-align:right">' +
          '<div style="margin-bottom:6px">' + status + ' <span class="badge penalty">扣 ' + stt.openPoints + ' 分</span></div>' +
          '<div class="hint">' + stt.fixed + '/' + stt.photos + ' 张已整改 · ' + stt.pct + '%</div>' +
        '</div>' +
        '<div class="batch-actions">' +
          '<a class="btn primary sm" href="#/batch/' + b.id + '">查看 / 录入</a>' +
          '<button class="btn sm" data-qr="' + b.id + '">整改二维码</button>' +
        '</div>' +
      '</div></div>';
    }).join('');

    $all('[data-qr]', list).forEach(function (btn) {
      btn.addEventListener('click', function () { openQRModal(btn.getAttribute('data-qr')); });
    });
  }

  /* ---------------- 门店管理弹窗 ---------------- */
  function openStoresModal() {
    var m = openModal(
      '<div class="modal-head"><h3>门店管理</h3><button class="modal-close">×</button></div>' +
      '<div class="modal-body">' +
        '<div class="field-grid"><div class="field"><label>门店名称 *</label><input id="s-name" placeholder="如：健康人连锁 · XX路店"></div>' +
        '<div class="field"><label>门店编号</label><input id="s-code" placeholder="留空自动生成"></div></div>' +
        '<div class="field"><label>地址</label><input id="s-addr" placeholder="选填"></div>' +
        '<button class="btn primary sm" id="s-add">＋ 添加门店</button>' +
        '<div id="s-list" class="mt12"></div>' +
      '</div>' +
      '<div class="modal-foot"><button class="btn primary" data-close>完成</button></div>'
    );
    function renderList() {
      var box = $('#s-list', m.root);
      if (!S.state.stores.length) { box.innerHTML = '<p class="hint">暂无门店，请先添加。</p>'; return; }
      box.innerHTML = S.state.stores.map(function (st) {
        var cnt = S.state.batches.filter(function (b) { return b.storeId === st.id; }).length;
        return '<div class="item" style="margin-bottom:8px"><div class="item-head">' +
          '<div class="item-title">' + esc(st.name) +
            '<div class="item-desc">编号 ' + esc(st.code) + (st.address ? ' · ' + esc(st.address) : '') + ' · 巡检 ' + cnt + ' 次</div></div>' +
          '<button class="btn danger sm" data-del="' + st.id + '">删除</button></div></div>';
      }).join('');
      $all('[data-del]', box).forEach(function (btn) {
        btn.addEventListener('click', function () {
          var id = btn.getAttribute('data-del');
          var cnt = S.state.batches.filter(function (b) { return b.storeId === id; }).length;
          confirmBox('删除门店', '该门店下的 ' + cnt + ' 个巡检批次及图片将一并删除。', '确认删除', function () {
            S.removeStore(id); toast('门店已删除'); renderList();
          });
        });
      });
    }
    $('#s-add', m.root).addEventListener('click', function () {
      var name = $('#s-name', m.root).value.trim();
      if (!name) { toast('请填写门店名称'); return; }
      S.addStore({ name: name, code: $('#s-code', m.root).value.trim(), address: $('#s-addr', m.root).value.trim() });
      $('#s-name', m.root).value = ''; $('#s-code', m.root).value = ''; $('#s-addr', m.root).value = '';
      toast('门店已添加'); renderList();
    });
    renderList();
  }

  /* ---------------- 发起巡检弹窗 ---------------- */
  function openBatchModal() {
    if (!S.state.stores.length) {
      toast('请先添加门店');
      openStoresModal();
      return;
    }
    var m = openModal(
      '<div class="modal-head"><h3>发起门店巡检</h3><button class="modal-close">×</button></div>' +
      '<div class="modal-body">' +
        '<div class="field"><label>选择门店 *</label><select id="b-store">' +
          S.state.stores.map(function (st) {
            return '<option value="' + st.id + '">' + esc(st.name) + '（' + esc(st.code) + '）</option>';
          }).join('') + '</select></div>' +
        '<div class="field"><label>督导人</label><input id="b-inspector" placeholder="如：王督导"></div>' +
        '<p class="hint">创建后即可录入问题与照片，并生成整改二维码发给门店店员。</p>' +
      '</div>' +
      '<div class="modal-foot"><button class="btn" data-close>取消</button>' +
      '<button class="btn primary" data-ok>创建并录入问题</button></div>'
    );
    var last = localStorage.getItem('pharm-last-inspector');
    if (last) $('#b-inspector', m.root).value = last;
    $('[data-ok]', m.root).addEventListener('click', function () {
      var storeId = $('#b-store', m.root).value;
      var inspector = $('#b-inspector', m.root).value.trim();
      var b = S.addBatch({ storeId: storeId, inspector: inspector });
      localStorage.setItem('pharm-last-inspector', inspector);
      m.close();
      location.hash = '#/batch/' + b.id;
    });
  }

  /* ---------------- 二维码弹窗 ---------------- */
  function openQRModal(batchId, itemId) {
    var b = S.getBatch(batchId);
    if (!b) return;
    var st = storeById(b.storeId);
    var url = fixUrl(batchId, itemId);
    var title = itemId
      ? '单项整改二维码'
      : '整批整改二维码 · ' + (st ? st.name : '');
    var sub = itemId
      ? '店员扫码后只显示这一条问题，整改完可继续处理其他问题'
      : '店员扫码后按顺序看到本批次全部待整改问题（批次 ' + batchNo(b) + '）';
    var m = openModal(
      '<div class="modal-head"><h3>' + esc(title) + '</h3><button class="modal-close">×</button></div>' +
      '<div class="modal-body print-sheet"><div class="qr-box">' +
        '<div class="qr-img" id="qr-canvas"></div>' +
        '<div class="qr-side"><b>' + esc(st ? st.name : '') + '</b>' +
          '<p class="hint" style="margin:6px 0">' + esc(sub) + '</p>' +
          '<p class="hint" style="margin:0">督导：' + esc(b.inspector || '—') + '<br>发起时间：' + fmtDate(b.createdAt) + '</p>' +
          '<div class="qr-url">' + esc(url) + '</div>' +
        '</div>' +
      '</div></div>' +
      '<div class="modal-foot"><button class="btn" data-close>关闭</button>' +
      '<button class="btn primary" id="qr-print">打印 / 另存</button></div>'
    );
    makeQR($('#qr-canvas', m.root), url);
    $('#qr-print', m.root).addEventListener('click', function () { window.print(); });
  }

  /* ================================================================
   *  视图：批次详情（督导录入问题）
   * ================================================================ */
  function viewBatch(id) {
    var b = S.getBatch(id);
    var app = $('#app');
    if (!b) { app.innerHTML = '<div class="card empty">批次不存在或已删除。<br><a class="btn sm mt12" href="#/supervisor">返回督导端</a></div>'; return; }
    var st = storeById(b.storeId);
    var stt = batchStats(b);

    app.innerHTML =
      '<div class="page-head"><div><h1>' + esc(st ? st.name : '（已删除门店）') + '</h1>' +
      '<p class="sub">' + batchNo(b) + ' · 督导 ' + esc(b.inspector || '—') + ' · ' + fmtDate(b.createdAt) + '</p></div>' +
      '<div class="row no-print">' +
        '<a class="btn" href="#/supervisor">← 返回列表</a>' +
        '<button class="btn" id="head-qr">整批整改码</button>' +
        (b.closed ? '<button class="btn" data-reopen>重新打开</button>'
                  : '<button class="btn" data-close-batch>归档批次</button>') +
      '</div></div>' +

      '<div class="card"><div class="ring-wrap">' +
        '<div class="ring" style="--p:' + stt.pct + '"><div class="inner">' + stt.pct + '%</div></div>' +
        '<div style="flex:1;min-width:200px">' +
          '<div class="stat-grid" style="margin:0">' +
            '<div class="stat" style="box-shadow:none;padding:0"><div class="k">问题项</div><div class="v">' + stt.itemsTotal + '</div></div>' +
            '<div class="stat" style="box-shadow:none;padding:0"><div class="k">已整改项</div><div class="v">' + stt.itemsDone + '</div></div>' +
            '<div class="stat" style="box-shadow:none;padding:0"><div class="k">照片配对</div><div class="v">' + stt.fixed + '<small>/' + stt.photos + '</small></div></div>' +
            '<div class="stat" style="box-shadow:none;padding:0"><div class="k">待整改扣分</div><div class="v" style="color:var(--red)">' + stt.openPoints + '<small> / ' + stt.points + '</small></div></div>' +
          '</div>' +
        '</div>' +
      '</div></div>' +

      '<div class="no-print"><button class="btn primary" id="add-item">＋ 添加问题（拍照 / 相册）</button></div>' +
      '<div class="section-title">问题清单（编号按当前顺序连续显示）</div>' +
      '<div id="items"></div>';

    var qrHeadBtn = $('#head-qr', app);
    if (qrHeadBtn) qrHeadBtn.addEventListener('click', function () { openQRModal(b.id); });
    var closeBtn = $('[data-close-batch]', app);
    if (closeBtn) closeBtn.addEventListener('click', function () {
      if (stt.pct < 100 && !confirm('仍有问题未整改完成，确定归档吗？')) return;
      S.setBatchClosed(b.id, true); toast('批次已归档'); viewBatch(b.id);
    });
    var reopenBtn = $('[data-reopen]', app);
    if (reopenBtn) reopenBtn.addEventListener('click', function () {
      S.setBatchClosed(b.id, false); toast('已重新打开'); viewBatch(b.id);
    });
    $('#add-item', app).addEventListener('click', openItemModal.bind(null, b.id, null));

    var wrap = $('#items', app);
    if (!b.items.length) {
      wrap.innerHTML = '<div class="card empty"><div class="big">▣</div>还没有问题记录<br><span class="hint">点击「添加问题」上传药品陈列、冷藏柜或处方药区照片</span></div>';
      return;
    }
    wrap.innerHTML = b.items.map(function (it, idx) {
      var cat = CATS[it.cat] || CATS.other;
      var p = itemProgress(it);
      var doneCls = p.total && p.done === p.total ? ' done-state' : '';
      var thumbs = it.photos.map(function (ph, pi) {
        var fix = it.fixes[pi];
        return '<div class="pair-line">' +
          '<div class="thumb"><img data-img-id="' + ph.imageId + '" alt="问题图 ' + (pi + 1) + '">' +
            '<span class="seq">问题图 ' + (pi + 1) + '</span></div>' +
          '<span class="pair-arrow">➜</span>' +
          (fix
            ? '<div class="thumb"><img data-img-id="' + fix.imageId + '" alt="整改图 ' + (pi + 1) + '">' +
              '<span class="seq" style="background:rgba(46,120,70,.85)">整改图 ' + (pi + 1) + '</span></div>' +
              '<span class="pair-info">' + esc(fix.by || '店员') + '<br>' + fmtDate(fix.at) + '</span>'
            : '<div class="upload-slot" style="width:88px;height:88px;cursor:default"><span class="cap" style="position:static">待整改</span></div>') +
          (!b.closed ? '<button class="btn danger sm" data-del-photo="' + idx + '" title="删除该问题图（编号自动连续）">删图</button>' : '') +
        '</div>';
      }).join('');
      return '<div class="item' + doneCls + '" data-item="' + it.id + '">' +
        '<div class="item-head">' +
          '<span class="item-no">#' + pad(idx + 1) + '</span>' +
          '<span class="badge ' + cat.cls + '">' + cat.name + '</span>' +
          (p.total && p.done === p.total ? '<span class="badge done">已整改</span>'
            : '<span class="badge open">待整改 ' + (p.total - p.done) + ' 图</span>') +
          '<span class="badge penalty">扣 ' + it.points + ' 分</span>' +
          '<div class="spacer"></div>' +
          (!b.closed
            ? '<div class="row"><button class="btn sm" data-item-qr>单项码</button>' +
              '<button class="btn sm" data-edit>编辑</button>' +
              '<button class="btn danger sm" data-del-item>删除</button></div>'
            : '') +
        '</div>' +
        '<div class="item-title">' + esc(it.title) + '</div>' +
        (it.desc ? '<p class="item-desc">' + esc(it.desc) + '</p>' : '') +
        '<div class="pair-grid"><div class="pair-col"><h4><span class="dot dot-problem"></span>问题 → 整改 成对图片</h4>' +
          '<div class="fix-item-grid">' + thumbs + '</div></div></div>' +
      '</div>';
    }).join('');

    hydrateImages(wrap);

    $all('.item', wrap).forEach(function (card) {
      var it = b.items.find(function (x) { return x.id === card.getAttribute('data-item'); });
      if (!it) return;
      var idx = b.items.indexOf(it);
      var editBtn = $('[data-edit]', card);
      if (editBtn) editBtn.addEventListener('click', function () { openItemModal(b.id, it.id); });
      var itemQrBtn = $('[data-item-qr]', card);
      if (itemQrBtn) itemQrBtn.addEventListener('click', function () { openQRModal(b.id, it.id); });
      var delItemBtn = $('[data-del-item]', card);
      if (delItemBtn) delItemBtn.addEventListener('click', function () {
        confirmBox('删除问题 #' + pad(idx + 1), '删除「' + it.title + '」及其全部问题图、整改图，后续编号将自动前移连续。', '确认删除', function () {
          S.removeItem(b.id, it.id); toast('已删除，编号重新连续排列'); viewBatch(b.id);
        });
      });
      $all('[data-del-photo]', card).forEach(function (btn) {
        btn.addEventListener('click', function () {
          var pi = Number(btn.getAttribute('data-del-photo'));
          confirmBox('删除问题图 ' + (pi + 1), '该问题图及对应整改图将一并删除，剩余图片编号自动连续。', '确认删图', function () {
            S.removeProblemPhoto(b.id, it.id, it.photos[pi]);
            toast('图片已删除，编号已重新连续');
            viewBatch(b.id);
          });
        });
      });
    });
  }

  /* ---------------- 问题新增 / 编辑弹窗 ---------------- */
  function openItemModal(batchId, itemId) {
    var b = S.getBatch(batchId);
    var editing = itemId ? b.items.find(function (x) { return x.id === itemId; }) : null;
    var up = uploader(editing ? editing.photos : []);

    var m = openModal(
      '<div class="modal-head"><h3>' + (editing ? '编辑问题 #' + itemNo(b, editing) : '添加巡检问题') + '</h3>' +
        '<button class="modal-close">×</button></div>' +
      '<div class="modal-body">' +
        '<div class="field-grid">' +
          '<div class="field"><label>问题类别 *</label><select id="i-cat">' +
            CAT_LIST.map(function (c) {
              return '<option value="' + c + '"' + (editing && editing.cat === c ? ' selected' : '') + '>' +
                CATS[c].name + '</option>';
            }).join('') + '</select></div>' +
          '<div class="field"><label>扣分值（分）</label><input id="i-points" type="number" min="0" step="1" value="' +
            (editing ? editing.points : 2) + '"></div>' +
        '</div>' +
        '<div class="field"><label>问题标题 *</label><input id="i-title" placeholder="如：冷藏柜温度超过 8℃" value="' +
          esc(editing ? editing.title : '') + '"></div>' +
        '<div class="field"><label>问题描述 / 整改要求</label><textarea id="i-desc" placeholder="如：立即转移药品、检修压缩机并补登温控记录">' +
          esc(editing ? editing.desc : '') + '</textarea></div>' +
        '<div class="field"><label>问题图片（可多选 / 连拍，删除后编号自动连续）</label><div id="i-uploader"></div></div>' +
      '</div>' +
      '<div class="modal-foot"><button class="btn" data-close>取消</button>' +
      '<button class="btn primary" data-ok>' + (editing ? '保存修改' : '添加问题') + '</button></div>'
    );
    $('#i-uploader', m.root).appendChild(up.el);
    hydrateImages(m.root);

    $('[data-ok]', m.root).addEventListener('click', function () {
      var cat = $('#i-cat', m.root).value;
      var title = $('#i-title', m.root).value.trim();
      var points = $('#i-points', m.root).value;
      var desc = $('#i-desc', m.root).value.trim();
      if (!title) { toast('请填写问题标题'); return; }

      if (editing) {
        // 编辑：从后往前删除被移除的图片（按对象引用定位，
        // removeProblemPhoto 同步删除对应整改图，剩余图片编号自动连续）
        var keepIds = {};
        up.files.forEach(function (f) { if (f.imageId) keepIds[f.imageId] = 1; });
        var cur0 = S.getBatch(batchId).items.find(function (x) { return x.id === editing.id; });
        for (var di = cur0.photos.length - 1; di >= 0; di--) {
          if (!keepIds[cur0.photos[di].imageId]) {
            S.removeProblemPhoto(batchId, editing.id, cur0.photos[di]);
          }
        }
        // 追加新增图片（编号排在末尾，自动连续）
        var curItem = S.getBatch(batchId).items.find(function (x) { return x.id === editing.id; });
        up.files.forEach(function (f) {
          if (f.imageId && curItem.photos.every(function (p) { return p.imageId !== f.imageId; })) {
            S.appendProblemPhoto(batchId, editing.id, f.imageId);
          }
        });
        S.updateItem(batchId, editing.id, { cat: cat, title: title, desc: desc, points: points });
        toast('修改已保存');
      } else {
        if (!up.files.length) { toast('请至少上传一张问题图片'); return; }
        S.addItem(batchId, {
          cat: cat, title: title, desc: desc, points: points,
          photos: up.files.map(function (f) { return { imageId: f.imageId }; })
        });
        toast('问题已添加');
      }
      m.close();
      viewBatch(batchId);
    });
  }

  /* ================================================================
   *  视图：店员整改页（扫码进入）
   * ================================================================ */
  function viewFix(query) {
    var app = $('#app');
    var b = S.getBatch(query.b);
    if (!b) {
      app.innerHTML = '<div class="card empty"><div class="big">▦</div>二维码无效或巡检已删除<br>' +
        '<p class="hint">请联系督导确认</p></div>';
      return;
    }
    var st = storeById(b.storeId);
    var stt = batchStats(b);
    var focusId = query.i || null;

    var staffName = localStorage.getItem('pharm-staff-name') || '';
    var allDone = stt.photos > 0 && stt.fixed === stt.photos;

    app.innerHTML =
      '<div class="fix-banner ' + (allDone ? 'alldone' : 'open') + '">' +
        '<h2>' + (allDone ? '✓ 全部问题已整改完成' : esc(st ? st.name : '')) + '</h2>' +
        '<p>' + batchNo(b) + ' · 督导 ' + esc(b.inspector || '—') + ' · 整改进度 ' + stt.fixed + '/' + stt.photos + ' 张（' + stt.pct + '%）</p>' +
        '<div class="fix-input-row">👤<input id="staff-name" placeholder="填写整改人姓名（选填）" value="' + esc(staffName) + '"></div>' +
      '</div>' +
      (b.closed ? '<div class="card" style="border-left:4px solid var(--muted)"><b>该批次已归档</b><p class="hint" style="margin:4px 0 0">整改结果仅供查看，如需补充照片请联系督导重新打开批次。</p></div>' : '') +
      '<div class="card"><b>整改要求</b><ol style="margin:8px 0 0;padding-left:20px;color:#44524f">' +
        '<li>对照左侧问题图逐项整改，点击每张问题图旁的按钮上传整改后的照片；</li>' +
        '<li>传错可点「重传」替换；全部问题传完即完成，无需额外提交。</li></ol></div>' +
      '<div id="fix-items"></div>';

    var nameInput = $('#staff-name', app);
    nameInput.addEventListener('change', function () {
      localStorage.setItem('pharm-staff-name', nameInput.value.trim());
      toast('已记录整改人');
    });

    var wrap = $('#fix-items', app);
    var items = b.items.filter(function (it) { return !focusId || it.id === focusId; });
    if (!items.length) {
      wrap.innerHTML = '<div class="card empty">未找到对应问题条目</div>';
      return;
    }
    wrap.innerHTML = items.map(function (it) {
      var cat = CATS[it.cat] || CATS.other;
      var p = itemProgress(it);
      var done = p.total && p.done === p.total;
      var lines = it.photos.map(function (ph, pi) {
        var fix = it.fixes[pi];
        return '<div class="pair-line">' +
          '<div class="thumb"><img data-img-id="' + ph.imageId + '" alt="问题图"><span class="seq">问题图 ' + (pi + 1) + '</span></div>' +
          '<span class="pair-arrow">➜</span>' +
          (fix
            ? '<div class="thumb"><img data-img-id="' + fix.imageId + '" alt="整改图">' +
                '<span class="seq" style="background:rgba(46,120,70,.85)">整改图 ' + (pi + 1) + '</span></div>' +
              '<span class="pair-info">' + esc(fix.by || '店员') + '<br>' + fmtDate(fix.at) + '</span>'
            : '<div class="upload-slot" style="width:88px;height:88px"><span class="cap">待整改</span></div>') +
          '<div class="row">' +
            (fix && !b.closed
              ? '<label class="btn sm">重传<input type="file" accept="image/*" capture="environment" hidden data-upload="' + pi + '"></label>'
              : (!b.closed ? '<label class="btn primary sm">上传整改图<input type="file" accept="image/*" capture="environment" hidden data-upload="' + pi + '"></label>' : '')) +
          '</div>' +
        '</div>';
      }).join('');

      return '<div class="item' + (done ? ' done-state' : '') + '" data-item="' + it.id + '">' +
        '<div class="item-head"><span class="item-no">#' + pad(b.items.indexOf(it) + 1) + '</span>' +
          '<span class="badge ' + cat.cls + '">' + cat.name + '</span>' +
          (done ? '<span class="badge done">本项已整改 ✓</span>' : '<span class="badge open">待整改 ' + (p.total - p.done) + '/' + p.total + ' 图</span>') +
        '</div>' +
        '<div class="item-title">' + esc(it.title) + '</div>' +
        (it.desc ? '<p class="item-desc">' + esc(it.desc) + '</p>' : '') +
        '<h4 style="margin:10px 0 4px;font-size:13px"><span class="dot dot-problem" style="display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--red)"></span> 问题图 ➜ <span class="dot dot-fix" style="display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--green)"></span> 整改图</h4>' +
        '<div class="fix-item-grid">' + lines + '</div>' +
      '</div>';
    }).join('');

    hydrateImages(wrap);

    $all('.item', wrap).forEach(function (card) {
      var it = b.items.find(function (x) { return x.id === card.getAttribute('data-item'); });
      $all('[data-upload]', card).forEach(function (inp) {
        inp.addEventListener('change', function () {
          var file = inp.files[0];
          var pi = Number(inp.getAttribute('data-upload'));
          if (!file) return;
          var by = $('#staff-name', app).value.trim();
          localStorage.setItem('pharm-staff-name', by);
          inp.disabled = true;
          S.ingestImage(file).then(function (id) {
            S.setFix(b.id, it.id, pi, id, by);
            toast('整改图已上传，第 ' + (pi + 1) + ' 张已配对');
            viewFix(query);
          }).catch(function (e) { toast(e.message); inp.disabled = false; });
        });
      });
    });
  }

  /* ================================================================
   *  视图：老板汇总页
   * ================================================================ */
  function viewBoss() {
    var app = $('#app');
    var batches = S.state.batches;
    var storeFilter = app.dataset.storeFilter || '';
    var statusFilter = app.dataset.statusFilter || 'all';

    // 全局统计
    var totalPhotos = 0, totalFixed = 0, totalPoints = 0, openPointsAll = 0;
    batches.forEach(function (b) {
      var st = batchStats(b);
      totalPhotos += st.photos; totalFixed += st.fixed;
      totalPoints += st.points; openPointsAll += st.openPoints;
    });
    var pctAll = totalPhotos ? Math.round(totalFixed / totalPhotos * 100) : 0;

    // 门店维度
    var storeRows = S.state.stores.map(function (st) {
      var bs = batches.filter(function (b) { return b.storeId === st.id; });
      var ph = 0, fx = 0, pts = 0, openPts = 0;
      bs.forEach(function (b) {
        var s = batchStats(b);
        ph += s.photos; fx += s.fixed; pts += s.points; openPts += s.openPoints;
      });
      return { st: st, count: bs.length, pct: ph ? Math.round(fx / ph * 100) : 0, ph: ph, fx: fx, points: pts, openPoints: openPts };
    });

    var visible = batches.filter(function (b) {
      if (storeFilter && b.storeId !== storeFilter) return false;
      var s = batchStats(b);
      if (statusFilter === 'open') return !b.closed && s.pct < 100;
      if (statusFilter === 'done') return s.pct === 100;
      return true;
    });

    app.innerHTML =
      '<div class="page-head"><div><h1>老板汇总 · 全连锁整改看板</h1>' +
      '<p class="sub">问题图与整改图成对查看，实时统计扣分项与完成率</p></div>' +
      '<button class="btn no-print" onclick="window.print()">打印报表</button></div>' +

      '<div class="stat-grid">' +
        '<div class="stat"><div class="k">巡检批次</div><div class="v">' + batches.length + '<small> 批</small></div></div>' +
        '<div class="stat"><div class="k">覆盖门店</div><div class="v">' + S.state.stores.length + '<small> 家</small></div></div>' +
        '<div class="stat"><div class="k">总扣分</div><div class="v" style="color:var(--red)">' + totalPoints + '<small> 分</small></div></div>' +
        '<div class="stat"><div class="k">待整改扣分</div><div class="v" style="color:var(--amber)">' + openPointsAll + '<small> 分</small></div></div>' +
      '</div>' +

      '<div class="card"><div class="ring-wrap">' +
        '<div class="ring" style="--p:' + pctAll + '"><div class="inner">' + pctAll + '%</div></div>' +
        '<div><h2 style="margin:0">全连锁整改完成率</h2>' +
        '<p class="hint" style="margin:4px 0 0">按图片口径：已整改 ' + totalFixed + ' / ' + totalPhotos + ' 张问题图</p></div>' +
      '</div></div>' +

      '<div class="card"><h2>各门店排名</h2>' +
        (storeRows.length
          ? '<table style="width:100%;border-collapse:collapse;font-size:14px">' +
            '<thead><tr style="color:var(--muted);font-size:13px;text-align:left">' +
            '<th style="padding:8px 6px">门店</th><th>巡检</th><th>完成率</th><th>配对</th><th>扣分</th><th>待整改扣分</th></tr></thead><tbody>' +
            storeRows.sort(function (a, b2) { return b2.pct - a.pct; }).map(function (r) {
              return '<tr style="border-top:1px solid var(--line);cursor:pointer" data-filter-store="' + r.st.id + '">' +
                '<td style="padding:9px 6px;font-weight:600">' + esc(r.st.name) +
                  '<div class="hint" style="font-weight:400;font-size:12px">' + esc(r.st.code) + '</div></td>' +
                '<td>' + r.count + '</td>' +
                '<td><b style="color:' + (r.pct === 100 ? 'var(--green)' : 'var(--amber)') + '">' + r.pct + '%</b></td>' +
                '<td>' + r.fx + '/' + r.ph + '</td>' +
                '<td style="color:var(--red);font-weight:600">' + r.points + '</td>' +
                '<td>' + (r.openPoints > 0 ? '<b style="color:var(--amber)">' + r.openPoints + '</b>' : '0') + '</td></tr>';
            }).join('') + '</tbody></table>'
          : '<p class="hint">暂无数据，可先到首页载入演示数据。</p>') +
      '</div>' +

      '<div class="filters no-print">' +
        '<button class="chip ' + (statusFilter === 'all' ? 'active' : '') + '" data-status="all">全部批次</button>' +
        '<button class="chip ' + (statusFilter === 'open' ? 'active' : '') + '" data-status="open">整改中</button>' +
        '<button class="chip ' + (statusFilter === 'done' ? 'active' : '') + '" data-status="done">已完成</button>' +
        (storeFilter
          ? '<button class="chip active" id="clear-store-filter">✕ ' + esc((storeById(storeFilter) || {}).name || '门店') + '</button>'
          : '') +
      '</div>' +
      '<div id="boss-batches"></div>';

    $all('[data-status]', app).forEach(function (btn) {
      btn.addEventListener('click', function () {
        app.dataset.statusFilter = btn.getAttribute('data-status');
        viewBoss();
      });
    });
    $all('[data-filter-store]', app).forEach(function (tr) {
      tr.addEventListener('click', function () {
        app.dataset.storeFilter = tr.getAttribute('data-filter-store');
        app.dataset.statusFilter = 'all';
        viewBoss();
        window.scrollTo({ top: document.querySelector('#boss-batches').getBoundingClientRect().top + window.scrollY - 70, behavior: 'smooth' });
      });
    });
    var clearBtn = $('#clear-store-filter', app);
    if (clearBtn) clearBtn.addEventListener('click', function () { delete app.dataset.storeFilter; viewBoss(); });

    var box = $('#boss-batches', app);
    if (!visible.length) {
      box.innerHTML = '<div class="card empty"><div class="big">◷</div>当前筛选条件下没有批次</div>';
      return;
    }

    visible.forEach(function (b) {
      var st = storeById(b.storeId);
      var s = batchStats(b);
      var sec = document.createElement('div');
      sec.className = 'card';
      var status = b.closed ? '<span class="badge closed">已归档</span>'
        : (s.pct === 100 ? '<span class="badge done">整改完成</span>' : '<span class="badge open">整改中</span>');
      sec.innerHTML =
        '<div class="batch-main" style="padding:0 0 12px;border-bottom:1px solid var(--line);margin-bottom:12px">' +
          '<div class="store-avatar">' + esc((st && st.name.slice(-2)) || '门店') + '</div>' +
          '<div class="batch-meta"><div class="t">' + esc(st ? st.name : '（已删除门店）') +
            ' <span class="muted" style="font-size:12px">' + batchNo(b) + '</span></div>' +
          '<div class="m">督导 ' + esc(b.inspector || '—') + ' · ' + fmtDate(b.createdAt) + '</div></div>' +
          '<div style="text-align:right">' + status +
            '<div class="hint mt8">扣分 <b style="color:var(--red)">' + s.points + '</b> · 待整改 <b style="color:var(--amber)">' + s.openPoints + '</b></div>' +
            '<div class="hint">完成率 <b style="color:var(--teal-d)">' + s.pct + '%</b>（' + s.fixed + '/' + s.photos + '）</div></div>' +
        '</div>' +
        b.items.map(function (it, idx) {
          var cat = CATS[it.cat] || CATS.other;
          var p = itemProgress(it);
          var done = p.total && p.done === p.total;
          var pairs = it.photos.map(function (ph, pi) {
            var fix = it.fixes[pi];
            return '<div class="pair-line">' +
              '<div class="thumb"><img data-img-id="' + ph.imageId + '" alt="问题图"><span class="seq">问' + (pi + 1) + '</span></div>' +
              '<span class="pair-arrow">➜</span>' +
              (fix
                ? '<div class="thumb"><img data-img-id="' + fix.imageId + '" alt="整改图"><span class="seq" style="background:rgba(46,120,70,.85)">改' + (pi + 1) + '</span></div>' +
                  '<span class="pair-info">' + esc(fix.by || '店员') + '<br>' + fmtDay(fix.at) + '</span>'
                : '<div class="upload-slot" style="width:88px;height:88px;cursor:default"><span class="cap" style="position:static">缺整改图</span></div>') +
            '</div>';
          }).join('');
          return '<div class="item' + (done ? ' done-state' : '') + '">' +
            '<div class="item-head"><span class="item-no">#' + pad(idx + 1) + '</span>' +
              '<span class="badge ' + cat.cls + '">' + cat.name + '</span>' +
              '<div class="item-title" style="flex:0 1 auto">' + esc(it.title) + '</div>' +
              (done ? '<span class="badge done">已整改</span>' : '<span class="badge open">未完成</span>') +
              '<span class="badge penalty">-' + it.points + ' 分</span></div>' +
            (it.desc ? '<p class="item-desc" style="margin:0 0 8px">' + esc(it.desc) + '</p>' : '') +
            '<div class="fix-item-grid">' + pairs + '</div></div>';
        }).join('');
      box.appendChild(sec);
    });
    hydrateImages(box);
  }

  /* ================================================================
   *  路由
   * ================================================================ */
  function parseQuery(qs) {
    var out = {};
    qs.replace(/^\?/, '').split('&').forEach(function (kv) {
      if (!kv) return;
      var p = kv.split('=');
      out[decodeURIComponent(p[0])] = decodeURIComponent(p[1] || '');
    });
    return out;
  }
  function setActiveNav(route) {
    $all('.topnav a').forEach(function (a) {
      var n = a.getAttribute('data-nav');
      a.classList.toggle('active',
        (n === 'home' && route === '') ||
        (n === 'supervisor' && (route === 'supervisor' || route.indexOf('batch/') === 0)) ||
        (n === 'boss' && route === 'boss'));
    });
  }
  function router() {
    var hash = location.hash.replace(/^#\/?/, '');
    var path = hash.split('?')[0];
    var query = parseQuery(hash.indexOf('?') >= 0 ? hash.slice(hash.indexOf('?')) : '');
    setActiveNav(path);
    if (path === '' || path === 'home') viewHome();
    else if (path === 'supervisor') viewSupervisor();
    else if (path.indexOf('batch/') === 0) viewBatch(decodeURIComponent(path.slice(6)));
    else if (path === 'fix') viewFix(query);
    else if (path === 'boss') viewBoss();
    else { location.hash = '#/'; }
    window.scrollTo(0, 0);
  }

  window.addEventListener('hashchange', router);
  S.gcImages().then(router);
})();
