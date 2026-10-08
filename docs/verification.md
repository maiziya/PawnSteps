# PawnSteps 验收记录

验收日期：2026-10-08。所有下列检查均实际执行。

| 检查 | 结果 |
| --- | --- |
| SQLite HTTP 集成测试 | 34 passed；2 项 PostgreSQL 并发专用测试跳过 |
| PostgreSQL 17 HTTP 集成测试 | 36 passed；无跳过 |
| Alembic SQLite / PostgreSQL | 初始迁移成功；`alembic check` 均无模型差异 |
| TypeScript | `npm run typecheck` 通过 |
| Next.js 15.5.27 生产构建 | `npm run build` 通过；首页、管理员、微信回调页面生成成功 |
| Playwright，真实后端 | 11 passed；最后一轮连接 standalone 生产服务，13.6 秒，无跳过 |
| 响应式和主题 | 375、768、1024、1440px；浅色/暗色检查通过；无横向溢出或浏览器异常 |
| 前端依赖审计 | `npm audit`：0 vulnerabilities |
| Docker Compose | 实际构建并启动 Nginx、Next.js standalone、FastAPI、PostgreSQL；迁移服务成功退出、后端/数据库健康 |
| 生产 HTTP 转发 | 首页 200；API health 200；生产 API 文档 404 |
| 生产业务链 | 通过 Nginx 创建任务/奖励、完成后 XP 与解锁、删除恢复、上传及读取持久卷图片，全部通过 |
| Nginx TLS | 配置校验通过；使用临时 localhost 证书进行受信 TLS 请求，API health 200 |

## 覆盖的关键边界

- owner 隔离、非法 JWT 不回退游客、跨 owner 奖励关联拒绝、管理员 audience 独立。
- 每日达标重复请求只累计一次；跨天清零、达标撤销；服务端业务时区跨午夜与响应日期一致。
- 计划正配额总量、自动休息日与到期完成；课程文件夹不计入目标/进度。
- 八个并发首次请求只创建六个里程碑；八个并发当日达标仍只有一次贡献。
- 5 秒删除恢复窗口、令牌 owner 校验、过期拒绝；奖励手动锁定在刷新后保留。
- 邮箱验证码摘要、过期/重放/尝试限制；注册邮箱必须验证；修改密码撤销旧令牌。
- 微信 state 与浏览器绑定、供应商 code 交换、一次性 ticket、游客迁移。
- 图片类型、大小与像素验证；本地上传重编码及读取。
- 真实鼠标拖动进度条时仅预览，松手后提交；键盘排序持久化。
- Markdown/真实目录导入、自然文件名排序、分组统计、鼠标框选混合状态全选与全完成取消。
- 浏览器注册迁移、个人资料、改密、导出、退出后新密码登录、独立管理员查阅用户数据。

测试源代码在 `backend/tests/` 和 `frontend/tests/`。浏览器 HTML 报告由测试生成到 `frontend/playwright-report/index.html`，截图在 `frontend/test-results/`；这些运行产物不进入版本控制。

## 验证范围

微信供应商响应在集成测试中模拟；真实微信开放平台账户、SMTP 邮箱、S3 桶和公网域名凭据未提供，因此没有进行真实扫码、邮件投递或 S3 外部写入。TLS 验证使用临时测试证书，不代表已为公网域名签发证书。

后端依赖审计仍报告 python-jose 与传递依赖 ecdsa 的两类已知问题；当前严格 HS256 私密对称密钥调用路径不使用这些问题涉及的操作，适用分析见 [security.md](security.md)。这不是“后端扫描零问题”的声明。

测试数据库、Compose 验证卷和 TLS 测试容器在验收后清理。本地前端与后端预览服务保留运行。支付与订阅仍为需求中的预留范围，不在本次验收中宣称完成。
