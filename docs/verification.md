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

## 任务首页布局改版

以提交 `6cb2ea4` 为改版前基线，保留暖色与暗色配色，调整首页信息顺序。统计改成固定顶部横栏；今日摘要在桌面和手机均可见；任务卡采用两行布局；说明按需展开，编辑/删除移入可访问菜单；已完成区域默认折叠；课程明细集中到抽屉，完成后保持打开。

同一类典型样例任务的浏览器实测：

| 指标 | 改版前 | 改版后 |
| --- | --- | --- |
| 1366×768，首卡起点 | 676 px | 237 px |
| 桌面普通任务卡高度 | 269 px | 120 px |
| 1366×768，首屏完整可操作任务 | 0 | 4 |
| 375×812，首卡起点 / 高度 | 未作同尺寸基线测量 | 243 px / 125 px |

浏览器回归扩展至 14 项，增加首屏几何测量、统计栏滚动常驻、手机搜索、长文本、菜单编辑、已完成区域键盘操作、课程完成后的焦点恢复。原有进度松手提交、排序、课程导入/框选、奖励、账号及管理员流程继续覆盖。测试曾发现长文本导致网格撑宽和课程退出动画导致焦点丢失，两处均已修复。

新生产构建通过，前端依赖审计无漏洞。本轮仅调整前端与相关文档，未修改后端业务合同。

### 空任务页面与整体框架复核

根据实际截图，撤回短悬浮侧栏，改为贯穿视口的导航区域。后续按侧栏截图进一步校正为上方导航、底部工具与账户，避免头像下方出现大片空白；短屏允许侧栏滚动。页头、正文、页脚统一 1160 px 最大宽度及边距；页脚归入页面框架底部。

真正没有任务时，移除打卡摘要、搜索、筛选和巨大空框，展示普通目标、每日打卡、天数计划、课程导入四个创建入口；首次创建后自动进入工作台，删除最后一项后恢复引导。筛选无匹配与加载失败分别处理。

1366×768、1920×1080、375×812 实际截图均已复查。四种创建入口在桌面及手机首屏均可操作。新增 3 项空态流程测试与既有 5 项布局/响应式回归共 8 项通过；未自动插入示例任务。

## 记录式进度与搜索框

进度展示改为只读，新增“记录今天”和带备注的历史记录。新增、修改、撤销后由服务端重新计算任务、当日达标、连续天数和 XP。一天可多次记录，配额超额部分仍保留实际数量；同日达标只计一天。课程仍采用逐项勾选。记录弹窗在任务完成后保持打开，奖励展示延后至关闭弹窗。

搜索框采用整个容器的 `focus-within` 边框与光圈，去除内层输入框的重复描边。已目视核对浅色、暗色与手机截图：搜索图标包含在同一外框内，输入和清除操作没有撑宽容器。

| 验证 | 结果 |
| --- | --- |
| SQLite HTTP 集成测试 | 45 passed，3 项 PostgreSQL 并发测试跳过 |
| PostgreSQL HTTP 集成测试 | 48 passed |
| 完整浏览器回归 | 17 passed，包含只读进度无写操作、新增/编辑/撤销、多次达标、课程及搜索 |
| 旧数据库副本升级 | 保留 153 项任务与 16 条原日历记录，生成 32 条标注为 legacy 的记录 |
| 升级后进度回算 | 152 项有效任务进度与备份一致；1 项原有软删除任务按既定过期规则清理 |
| SQLite / PostgreSQL Alembic 检查 | 模型与迁移一致，无新增操作 |

新迁移为 `cf42d17b8e91`。普通任务的旧累计量没有真实工作日期，因此保持 `date=null`，不记入升级当天；历史未达标日未保存过准确配额，按旧状态保留并标注来源。旧 `/progress`、`/daily`、`/daily/undo` 写接口返回 410，客户端改用记录 API。过期计划不再凭空补足进度，实际贡献通过只读进度显示。

升级前已使用 SQLite backup API 备份运行数据库，备份位于本地 `backend/backups/`，不会进入版本控制或镜像。

### 卡片快捷记录与进度反馈

任务卡新增 +1、+5、+10，点击即创建独立记录，无需先开表单。进度条以约 380ms 展示增长，保存后短暂显示本次增量；每日任务和有效计划的主条改为今日配额，累计目标仍显示在摘要中。达到整个目标后先保留满格卡片约 1.1 秒，再收进已完成区域、展示奖励。手机快捷按钮保持 44px 点击区域，历史入口仍支持其他数量、备注及修正。

乐观显示与正式任务数据分开；保存失败仅撤回预览。重试沿用原请求 ID，已完成任务也能确认先前不确定的请求，确认时不会再次预加数量。

浏览器套件现共 21 项：原 17 项与首轮新增快捷用例通过，补充“服务端已保存但响应失败”后，快捷记录 4 项和布局 3 项再次全部通过。覆盖逐次记录数量、每日与计划增长、超额保留、按下即时反馈、请求中禁重复、失败回退、同 ID 确认、满格停留、折叠与奖励顺序、移动端点击及历史编辑。1366×768 的桌面卡片仍约 120px；375×812 手机卡片约 164px，无横向溢出。

### 减步进、完成撤回与拖拽松手

快捷控件调整为 −1、+1、+5。普通记录不显示撤销提示；整项任务完成时才提供“撤销本次完成”，仅撤回促成本次完成的最后一条记录，保留更早记录。奖励弹窗内也提供同一撤回入口，避免弹窗挡住提示。−1 按原子事务修正最近一条有效记录，每日/计划任务仅处理今天，减至零禁用，并通过持久化回执避免重试多扣。

拖拽根因是 `onDragEnd` 等待服务器返回后才更新显示顺序。旧版本在响应延迟时，松手后的卡片从约 505px 回弹到 237px。修复只改变本地落位时机：松手同步应用临时顺序，保存成功采用服务器顺序，失败才回滚；既有 Motion 动画无需移除。

复现与回归命令：`E2E_BASE_URL=http://127.0.0.1:3018 npx playwright test tests/drag-release.spec.ts`。测试驱动真实指针拖拽并锁住排序响应至少 450ms，逐帧记录卡片位置。修复前成功/失败两路径均失败；修复后待响应期间位置稳定在约 497px，成功后保持、500 响应后才回滚。键盘排序保存后保留手柄焦点。

本轮 PostgreSQL 后端全套 62 项通过；SQLite 58 项通过、4 项并发测试跳过。浏览器全套 25 项通过，随后新增“完成停留期立即 −1”回归并验证修复，当前 26 项均通过相应执行。包含完成撤回后的焦点恢复，以及修正请求未返回时卡片不提前消失。新迁移 `8d3619a56e20` 与 SQLite/PostgreSQL 模型检查通过，运行数据库已先备份再升级。


### 课程标题、框选与完成颜色

确认原课程的 59 个条目名称均包含 `| 1` 尾部字段，旧导入器将其当作标题保留。新导入会清理未转义的尾部整数标记，已有课程在显示层兼容清理，不改原条目索引与完成状态；字面转义竖线、代码和非数字竖线保留。

新增课程专项回归先在旧预览复现标题未清理、从条目文字无法起拖的两个失败，再验证修复。覆盖从条目起拖、正反方向、完成后再次框选取消、Shift 混合范围取消、普通点击不被吞、旧数据状态保留、长列表自动滚动、Esc 不提交，以及完成/取消的实际背景色变化。四项新用例与两项原课程导入/框选回归均通过。已目视核对浅色、暗色和手机截图，完成条目与整章使用绿色状态，无横向溢出。

## Calendar activity and daily minimum (2026-10-08)

- Calendar entries now aggregate active progress by task and business date, including ordinary tasks, partial daily/plan work, and newly dated course checks. Corrections and unchecks update the activity; undated legacy data is never assigned a fabricated date.
- Daily minimum (`daily_quota`) remains the achievement threshold. No work, partial work, meeting the minimum, and exceeding it have distinct calendar states; streaks and milestone rewards still use achieved daily history.
- SQLite integration suite: 62 passed, 4 PostgreSQL-only tests skipped. Calendar/quick-progress browser suite: 9 passed; course selection suite: 4 passed. Checked the calendar activity display on a 375 × 667 viewport.

## Fast course marquee selection (2026-10-08)

- Reproduced a one-move drag from a lesson beyond the course root: expected four completed items, received zero. Tracking previously started only after an in-root pointer move, so fast boundary crossings lost both movement and release events.
- Track pointer movement/release on the window from pointer-down; remove listeners on completion, cancellation and unmount. Determine a drag from final release coordinates too, so coalesced gestures need no intermediate move.
- Course browser checks: six passed across native fast completion/reversal, release without intermediate movement, normal clicking, Shift clearing, edge scrolling, Escape cancellation, and existing import/title handling. TypeScript check passed.

## Rapid consecutive course selection (2026-10-08)

- A delayed course response reproduced a second issue: releasing the marquee cleared its preview before the server updated checkboxes, and a global `busy` guard discarded subsequent gestures.
- Course selections now apply an immediate local projection and enqueue every valid intent through the existing serialized mutation pipeline. Responses remove only their own pending projection. Failures roll back that operation while preserving later overlapping or disjoint intents; complete selected index sets are retained for this purpose.
- Regression checks cover selecting then clearing before the first response, slow saves, independent failure rollback, overlapping selections after failure, and prior pointer/scroll/cancellation paths. Nine course checks passed across the regression runs.

## Visible marquee lost on release (2026-10-08)

- Reproduced the reported visible-highlight/no-commit outcome by releasing native pointer capture during an active four-item marquee. The old `lostpointercapture` handler cleared the gesture before the window received mouse release (four highlighted items, zero saved).
- Pointer capture loss no longer cancels the active gesture: window-level movement/release tracking already handles delivery independently. Explicit pointer cancellation, Escape and window blur still cancel safely.
- Pointer-down is now observed across the course drawer body, including padding gutters and native course checkboxes. Previously the gutter could not start a marquee at all.
- Chromium and WebKit each passed all 12 course checks, including capture loss, 12 consecutive one-move gestures across checkbox/text/gutter starts, reverse selection, queued saves, rollback, scrolling, and Escape.
- Optional WebKit regression command (from `frontend`): `npx playwright install webkit`, then `E2E_BASE_URL=http://127.0.0.1:3017 npx playwright test --config playwright.webkit.config.ts`.
