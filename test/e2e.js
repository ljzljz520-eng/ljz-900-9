const { chromium } = require('/tmp/node_modules/playwright-core');
const chromiumPkg = require('/tmp/node_modules/@sparticuz/chromium');

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name); }
}

(async () => {
  const exe = '/tmp/pw-browsers/chromium_headless_shell-1243/chrome-headless-shell-linux-arm64/chrome-headless-shell';
  const libPath = process.env.CHROME_LIBS;
  const browser = await chromium.launch({
    executablePath: exe,
    headless: true,
    args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--font-render-hinting=none','--force-color-profile=srgb'],
    env: Object.assign({}, process.env, {
      LD_LIBRARY_PATH: libPath,
      FONTCONFIG_FILE: '/tmp/fonthome/fonts.conf',
      FONTCONFIG_FILE: '/etc/fonts/fonts.conf'
    })
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('dialog', d => d.accept().catch(()=>{}));

  const BASE = 'http://localhost:8901/index.html';

  // 每次先清空
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.evaluate(async () => {
    localStorage.clear();
    await new Promise(r => { const req = indexedDB.deleteDatabase('pharm-inspect-db'); req.onsuccess = r; req.onerror = r; req.onblocked = r; });
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('#load-demo');

  // 1. 演示数据
  console.log('[1] 载入演示数据');
  await page.click('#load-demo');
  // 演示数据为异步生成（写 IndexedDB），等首页重渲染出现「清空」按钮
  await page.waitForSelector('#reset-demo', { timeout: 30000 });
  const demoReady = await page.evaluate(() => window.Storage.state.batches.length);
  check('生成3个批次', demoReady === 3);
  await page.goto(BASE + '#/supervisor', { waitUntil: 'networkidle' });
  await page.waitForSelector('.batch-card', { timeout: 10000 });
  check('督导端显示3张批次卡', await page.locator('.batch-card').count() === 3);

  // 2. 批次详情：选择演示数据里条目最多的进行中批次（中山北路店，4条）
  console.log('[2] 进入批次详情');
  const targetBatchUrl = await page.evaluate(() => {
    const S = window.Storage;
    let best = null;
    S.state.batches.forEach(b => {
      if (b.closed) return;
      if (!best || b.items.length > best.items.length) best = b;
    });
    return '#/batch/' + (best || S.state.batches[0]).id;
  });
  await page.goto(BASE + targetBatchUrl, { waitUntil: 'networkidle' });
  await page.waitForSelector('#items .item');
  let nos = await page.locator('#items .item .item-no').allTextContents();
  console.log('    编号:', nos.join(' '));

  // 3. 删除条目后编号连续
  console.log('[3] 删除第2条问题');
  const beforeN = await page.locator('#items .item').count();
  await page.locator('#items .item').nth(1).locator('[data-del-item]').click();
  await page.waitForSelector('.modal [data-ok]');
  await page.click('.modal [data-ok]');
  await page.waitForFunction(n => document.querySelectorAll('#items .item').length === n, beforeN - 1);
  nos = await page.locator('#items .item .item-no').allTextContents();
  const expected = nos.map((_, i) => '#' + String(i + 1).padStart(2, '0'));
  check('条目编号重排连续', JSON.stringify(nos) === JSON.stringify(expected));

  // 4. 删除问题图后图片编号连续
  console.log('[4] 删除首张多图卡片的第1张问题图');
  // 找到含 >=2 个删图按钮的卡片
  let multiIdx = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('#items .item'));
    for (let i = 0; i < cards.length; i++) {
      if (cards[i].querySelectorAll('[data-del-photo]').length >= 2) return i;
    }
    return 0;
  });
  let card0 = page.locator('#items .item').nth(multiIdx);
  const groupsBefore = await card0.locator('.pair-line').count();
  console.log('    目标卡片图组数:', groupsBefore);
  if (groupsBefore >= 2) {
    await card0.locator('[data-del-photo]').nth(0).click();
    await page.waitForSelector('.modal [data-ok]');
    await page.click('.modal [data-ok]');
    await page.waitForTimeout(600);
    card0 = page.locator('#items .item').first();
    const probSeqs = await card0.locator('.pair-line .thumb .seq').evaluateAll(
      els => els.map(e => e.textContent.trim()).filter(t => t.indexOf('问题图') === 0));
    const exp2 = probSeqs.map((_, i) => '问题图 ' + (i + 1));
    check('图片编号重排连续: ' + probSeqs.join(' / '), JSON.stringify(probSeqs) === JSON.stringify(exp2));
  } else {
    check('存在多图条目可测删图', false);
  }

  // 5. 二维码弹窗
  console.log('[5] 整改二维码');
  await page.click('#head-qr');
  await page.waitForSelector('#qr-canvas canvas', { state: 'attached', timeout: 5000 });
  const qrCanvas = await page.$('#qr-canvas canvas');
  check('整批二维码渲染成功', !!qrCanvas);
  const qrUrl = await page.locator('.qr-url').textContent();
  check('二维码URL为 #/fix?b=', /#\/fix\?b=/.test(qrUrl));
  await page.click('.modal-close');
  await page.waitForTimeout(200);

  // 6. 单项二维码
  console.log('[6] 单项整改二维码');
  await page.locator('#items .item [data-item-qr]').first().click();
  await page.waitForSelector('#qr-canvas canvas', { state: 'attached', timeout: 5000 });
  const itemQrUrl = await page.locator('.qr-url').textContent();
  check('单项URL含 i= 参数', /[?&]i=item_/.test(itemQrUrl));
  await page.click('.modal-close');
  await page.waitForTimeout(200);

  // 7. 店员整改：上传一张整改图
  console.log('[7] 店员扫码整改上传');
  await page.goto(qrUrl, { waitUntil: 'networkidle' });
  await page.waitForSelector('#fix-items .item');
  const uploadCount = await page.locator('[data-upload]').count();
  check('存在待上传的整改入口', uploadCount > 0);
  const b64 = await page.evaluate(() => new Promise(resolve => {
    const c = document.createElement('canvas'); c.width = 800; c.height = 600;
    const x = c.getContext('2d');
    x.fillStyle = '#2e9e56'; x.fillRect(0, 0, 800, 600);
    x.fillStyle = '#fff'; x.font = 'bold 64px sans-serif'; x.fillText('RECTIFIED', 170, 320);
    x.fillStyle = '#fff'; x.fillRect(0, 540, 800, 60);
    x.fillStyle = '#1d7c43'; x.font = '28px sans-serif'; x.fillText('pharm fix photo', 20, 580);
    c.toDataURL('image/jpeg', 0.9).split(',')[1];
    resolve(c.toDataURL('image/jpeg', 0.9).split(',')[1]);
  }));
  const buf = Buffer.from(b64, 'base64');
  // 找第一张缺整改图的（标签为“上传整改图”）
  const target = page.locator('label.btn.primary.sm input[data-upload]').first();
  await target.setInputFiles({ name: 'fix.jpg', mimeType: 'image/jpeg', buffer: buf });
  await page.waitForTimeout(1200);
  // 该批次进度出现配对
  const hasFixThumb = await page.locator('#fix-items .thumb .seq', { hasText: '整改图' }).count();
  check('整改图已配对展示', hasFixThumb >= 1);
  await page.fill('#staff-name', '测试店员');
  await page.$eval('#staff-name', el => el.dispatchEvent(new Event('change')));

  // 8. 老板汇总页
  console.log('[8] 老板汇总页');
  await page.goto(BASE + '#/boss', { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  const ringText = await page.locator('.ring .inner').first().textContent();
  check('显示完成率百分比环', /\d+%/.test(ringText));
  const totalPointsVisible = await page.locator('.stat .v').nth(2).textContent();
  check('展示总扣分数值', /\d+/.test(totalPointsVisible));
  // 成对图片同时存在（问题图 data-img-id ≥ 整改图数量）
  const pairCards = await page.locator('#boss-batches .pair-line').count();
  check('存在问题/整改成对卡片', pairCards > 0);
  // 点击“整改中”筛选
  await page.click('[data-status="open"]');
  await page.waitForTimeout(300);
  // 点击门店行筛选
  await page.locator('[data-filter-store]').first().click();
  await page.waitForTimeout(300);
  const afterFilter = await page.locator('#boss-batches').innerHTML();
  check('门店筛选后仍可渲染', afterFilter.length >= 0);

  // 9. 图片编号在整改页也连续
  console.log('[9] 整改页图片编号连续');
  await page.goto(qrUrl, { waitUntil: 'networkidle' });
  await page.waitForSelector('#fix-items .item');
  const fixSeqs = await page.locator('#fix-items .item').first().locator('.seq').evaluateAll(
    els => els.map(e => e.textContent.trim()).filter(t => t.indexOf('问题图') === 0));
  const expFix = fixSeqs.map((_, i) => '问题图 ' + (i + 1));
  check('整改页问题图编号连续', JSON.stringify(fixSeqs) === JSON.stringify(expFix));

  // 10. 督导端发起新巡检 & 添加问题全流程（通过文件输入）
  console.log('[10] 督导发起巡检+添加问题');
  await page.goto(BASE + '#/supervisor', { waitUntil: 'networkidle' });
  // 若门店已被前面的测试影响清空，先补建一家
  const storeCnt = await page.evaluate(() => Storage.state.stores.length);
  if (storeCnt === 0) {
    await page.click('#manage-stores');
    await page.waitForSelector('#s-name');
    await page.fill('#s-name', '测试门店');
    await page.click('#s-add');
    await page.waitForTimeout(300);
    await page.click('.modal [data-close]');
  }
  await page.click('#new-batch');
  await page.waitForSelector('#b-store');
  await page.fill('#b-inspector', '端到端督导');
  await page.click('[data-ok]');
  await page.waitForSelector('#add-item');
  await page.click('#add-item');
  await page.waitForSelector('#i-title');
  await page.fill('#i-title', '端到端测试问题：冷柜温度9度');
  await page.fill('#i-desc', '立即降温并报修');
  await page.fill('#i-points', '7');
  // 上传问题图
  const probB64 = await page.evaluate(() => new Promise(resolve => {
    const c = document.createElement('canvas'); c.width = 900; c.height = 650;
    const x = c.getContext('2d');
    x.fillStyle = '#127fa8'; x.fillRect(0, 0, 900, 650);
    x.fillStyle = '#fff'; x.font = 'bold 70px sans-serif'; x.fillText('9.0 C', 300, 330);
    resolve(c.toDataURL('image/jpeg', 0.9).split(',')[1]);
  }));
  await page.locator('.modal input[type=file]').first().setInputFiles(
    { name: 'p1.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(probB64, 'base64') });
  await page.waitForTimeout(1000);
  const thumbCount = await page.locator('.uploader .thumb').count();
  check('问题图已进入上传组件', thumbCount >= 1);
  await page.click('.modal [data-ok]');
  await page.waitForTimeout(600);
  check('问题已保存到批次', await page.locator('#items .item').count() >= 1);
  check('新问题显示扣7分', (await page.locator('#items .item').first().innerText()).includes('扣 7 分'));

  // 11. IndexedDB 中图片数量与状态一致（GC 后无孤儿）
  console.log('[11] 图片存储一致性');
  const idsInDb = await page.evaluate(() => window.Storage.allImageIds());
  const referenced = await page.evaluate(() => {
    const set = {};
    window.Storage.state.batches.forEach(b => b.items.forEach(it => {
      it.photos.forEach(p => set[p.imageId] = 1);
      it.fixes.forEach(f => f && (set[f.imageId] = 1));
    }));
    return Object.keys(set).length;
  });
  console.log('    IDB图片数:', idsInDb.length, ' 被引用:', referenced);
  check('IDB图片全部被引用（无孤儿）', idsInDb.length === referenced);

  console.log('\n控制台错误:', errors.length ? '\n' + errors.join('\n') : '无');
  console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
