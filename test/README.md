# 端到端测试

使用 Playwright 驱动 Chromium，覆盖：
1. 演示数据生成（3 门店 3 批次）
2. 批次列表 / 详情
3. **删除条目后编号重新连续**
4. **删除问题图后图片编号重新连续**（对应整改图同步删除）
5. 整批 / 单项整改二维码生成与 URL
6. 店员扫码上传整改图（文件注入）→ 问题/整改配对
7. 老板汇总：完成率环、扣分、成对卡片、门店/状态筛选
8. 整改页编号连续
9. 督导发起巡检 + 多图上传新增问题
10. IndexedDB 图片引用一致性（无孤儿）

运行（需要本机 Chromium）：

```bash
# 静态服务
python3 -m http.server 8901 &
# 安装 playwright-core
npm i -D playwright-core
npx playwright install chromium-headless-shell
node test/e2e.js
```

脚本默认连接 http://localhost:8901 。
