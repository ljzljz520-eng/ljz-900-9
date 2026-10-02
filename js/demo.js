/* ============================================================
 * 演示数据：用 Canvas 绘制示意问题图 / 整改图
 * ============================================================ */
(function (global) {
  'use strict';

  var CATS = {
    display: { color: '#2563c9', shelf: '药品陈列' },
    fridge:  { color: '#127fa8', shelf: '冷藏柜' },
    rx:      { color: '#7a4fd6', shelf: '处方药区' },
    other:   { color: '#5a6b67', shelf: '其他区域' }
  };

  function drawPhoto(opts) {
    // opts: {cat, label, fixed, seed}
    var c = CATS[opts.cat] || CATS.other;
    var W = 900, H = 650;
    var cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    var ctx = cv.getContext('2d');

    // 背景墙
    var grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, '#eef3f2');
    grad.addColorStop(1, '#dce5e3');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    // 地板
    ctx.fillStyle = opts.fixed ? '#d9efe2' : '#e7ddc9';
    ctx.fillRect(0, H - 130, W, 130);

    // 货架
    ctx.fillStyle = '#f7f9f8';
    ctx.fillRect(70, 90, 560, 430);
    ctx.strokeStyle = '#b9c7c3';
    ctx.lineWidth = 3;
    ctx.strokeRect(70, 90, 560, 430);
    var shelfColors = ['#cfe0f7', '#d9f0ec', '#ece2f8', '#f7e4cf', '#d5e9ee'];
    for (var r = 0; r < 4; r++) {
      var y = 90 + r * 107;
      ctx.fillStyle = '#e3eae8';
      ctx.fillRect(70, y + 92, 560, 10);
      // 药盒
      for (var k = 0; k < 7; k++) {
        var bw = 60 + ((opts.seed + k * 7) % 18);
        var bh = 62 + ((opts.seed + k * 3) % 22);
        var bx = 88 + k * 76;
        var by = y + 92 - bh - 6;
        ctx.fillStyle = shelfColors[(k + r + opts.seed) % shelfColors.length];
        ctx.fillRect(bx, by, bw, bh);
        ctx.strokeStyle = '#9fb0ac';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(bx, by, bw, bh);
        ctx.fillStyle = '#5d706c';
        ctx.font = '11px sans-serif';
        for (var t = 0; t < 3; t++) {
          ctx.fillRect(bx + 9, by + 12 + t * 15, bw - 18, 4);
        }
      }
    }

    // 冷藏柜特征
    if (opts.cat === 'fridge') {
      ctx.fillStyle = 'rgba(120,190,235,.28)';
      ctx.fillRect(70, 90, 560, 430);
      ctx.strokeStyle = 'rgba(40,120,180,.55)';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(350, 90); ctx.lineTo(350, 520);
      ctx.stroke();
      // 温度表
      ctx.fillStyle = '#fff';
      ctx.fillRect(660, 120, 170, 110);
      ctx.strokeStyle = '#127fa8';
      ctx.lineWidth = 3;
      ctx.strokeRect(660, 120, 170, 110);
      ctx.fillStyle = opts.fixed ? '#2e9e56' : '#d23b3b';
      ctx.font = 'bold 46px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(opts.fixed ? '4.2℃' : '11.8℃', 745, 190);
      ctx.textAlign = 'left';
    }

    // 处方药区特征：Rx 标牌 + 柜台
    if (opts.cat === 'rx') {
      ctx.fillStyle = '#7a4fd6';
      ctx.fillRect(70, 30, 300, 52);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 30px sans-serif';
      ctx.fillText('℞  处方药专区', 92, 67);
      ctx.fillStyle = '#caa9f2';
      ctx.fillRect(80, 540, 540, 70);
    }

    // 问题标注（红圈）或整改通过（绿勾）
    if (!opts.fixed) {
      var cx = 200 + (opts.seed * 137) % 420;
      var cy = 150 + (opts.seed * 89) % 320;
      ctx.strokeStyle = '#e02828';
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.ellipse(cx, cy, 62, 48, -0.3, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#e02828';
      ctx.font = 'bold 30px sans-serif';
      ctx.fillText('✕ 问题', cx - 42, cy - 62);
    } else {
      ctx.fillStyle = 'rgba(46,158,86,.92)';
      ctx.beginPath();
      ctx.arc(745, 320, 60, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 12;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(712, 322);
      ctx.lineTo(738, 348);
      ctx.lineTo(786, 292);
      ctx.stroke();
      ctx.fillStyle = '#1d7c43';
      ctx.font = 'bold 26px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('已整改', 745, 420);
      ctx.textAlign = 'left';
    }

    // 顶栏标签
    ctx.fillStyle = c.color;
    ctx.fillRect(0, 0, W, 0);
    ctx.fillStyle = 'rgba(0,0,0,.55)';
    ctx.fillRect(0, H - 46, W, 46);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 22px sans-serif';
    ctx.fillText(c.shelf + ' · ' + opts.label, 18, H - 16);

    return cv;
  }

  function canvasId(opts) {
    return global.Storage.ingestCanvas(drawPhoto(opts));
  }

  function buildDemo() {
    var S = global.Storage;
    var st1 = S.addStore({ name: '健康人连锁 · 中山北路店', code: 'D001', address: '中山北路 128 号' });
    var st2 = S.addStore({ name: '健康人连锁 · 人民广场店', code: 'D002', address: '人民大道 66 号' });
    var st3 = S.addStore({ name: '健康人连锁 · 滨江大学城店', code: 'D003', address: '学府路 9 号' });

    return Promise.resolve().then(function () {
      var b1 = S.addBatch({ storeId: st1.id, inspector: '王督导' });
      var plan = [
        { cat: 'display', title: '处方药与非处方药混放', desc: '降压药摆放在 OTC 开架区，患者可自行拿取', points: 5, photos: ['混放现场', '价签缺失'], fixed: [true, false] },
        { cat: 'fridge', title: '冷藏柜温度超标', desc: '温控显示 11.8℃，超过 2~8℃ 储存要求，温度记录缺失 3 天', points: 10, photos: ['温度显示屏', '温度登记本'], fixed: [true, true] },
        { cat: 'rx', title: '处方留存不完整', desc: '抽查 10 张处方，2 张无执业药师审核签字', points: 8, photos: ['处方柜抽查'], fixed: [false] },
        { cat: 'display', title: '近效期药品未设专区', desc: '3 盒效期不足 3 个月的药品仍在正常货架', points: 6, photos: ['近效期药品'], fixed: [] }
      ];
      var chain = Promise.resolve();
      plan.forEach(function (p, pi) {
        chain = chain.then(function () {
          return Promise.all(p.photos.map(function (label, i) {
            return canvasId({ cat: p.cat, label: label, fixed: false, seed: pi * 5 + i + 1 });
          })).then(function (ids) {
            var item = S.addItem(b1.id, {
              cat: p.cat, title: p.title, desc: p.desc, points: p.points,
              photos: ids.map(function (id) { return { imageId: id }; })
            });
            return Promise.all(p.fixed.map(function (isFixed, i) {
              if (!isFixed) return null;
              return canvasId({ cat: p.cat, label: p.photos[i] + '（整改后）', fixed: true, seed: pi * 5 + i + 1 })
                .then(function (fid) { S.setFix(b1.id, item.id, i, fid, '李店员'); });
            }));
          });
        });
      });

      chain = chain.then(function () {
        var b2 = S.addBatch({ storeId: st2.id, inspector: '王督导' });
        var plan2 = [
          { cat: 'fridge', title: '冷藏柜门封条结霜', desc: '门封条结冰影响密闭，需除霜并检查胶条', points: 4, photos: ['门封条结霜'], fixed: [true] },
          { cat: 'rx', title: '药师不在岗未挂牌', desc: '中午时段执业药师离岗，未放置暂停销售处方药提示牌', points: 6, photos: ['药师台空岗'], fixed: [false] },
          { cat: 'other', title: '营业证照悬挂不规范', desc: '药品经营许可证被促销海报遮挡', points: 2, photos: ['证照墙'], fixed: [true] }
        ];
        var c2 = Promise.resolve();
        plan2.forEach(function (p, pi) {
          c2 = c2.then(function () {
            return canvasId({ cat: p.cat, label: p.photos[0], fixed: false, seed: 20 + pi }).then(function (id) {
              var item = S.addItem(b2.id, {
                cat: p.cat, title: p.title, desc: p.desc, points: p.points,
                photos: [{ imageId: id }]
              });
              if (p.fixed[0]) {
                return canvasId({ cat: p.cat, label: p.photos[0] + '（整改后）', fixed: true, seed: 20 + pi })
                  .then(function (fid) { S.setFix(b2.id, item.id, 0, fid, '赵店员'); });
              }
            });
          });
        });
        return c2;
      });

      chain = chain.then(function () {
        // 第三个门店：已归档的上月巡检（全部整改完成）
        var b3 = S.addBatch({ storeId: st3.id, inspector: '陈督导' });
        S.setBatchClosed(b3.id, true);
        return canvasId({ cat: 'display', label: '堆头占道', fixed: false, seed: 40 }).then(function (id) {
          var item = S.addItem(b3.id, { cat: 'display', title: '促销堆头占用消防通道', desc: '入口堆头超出黄线', points: 4, photos: [{ imageId: id }] });
          return canvasId({ cat: 'display', label: '堆头占道（整改后）', fixed: true, seed: 40 })
            .then(function (fid) { S.setFix(b3.id, item.id, 0, fid, '周店员'); });
        });
      });

      return chain;
    });
  }

  global.DemoData = { build: buildDemo, hasData: function () { return S_hasData(); } };
  function S_hasData() { return global.Storage.state.batches.length > 0; }
})(window);
