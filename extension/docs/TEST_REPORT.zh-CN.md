# BTR Flow 1.1.0 验证记录

日期：2026-10-06。Node 22.16.0；Chromium 144.0.7559.96；Python Playwright。

## 完成结果

| 层次 | 通过 | 实际执行内容 | 不代表什么 |
| --- | ---: | --- | --- |
| Node 核心测试 | 63 | 原 40 项核心回归，新增线程启动、策略上限、URL／历史校验、诊断脱敏、版本／资源，以及 MSE 初始化／音轨选择逻辑检查 | 不是真实 CDN、真实 HDR 解码或安装验证 |
| 首页／设置渲染 | 29 | 真实 Chromium 渲染本地 DOM；模拟 Chrome 存储与推荐按钮；检查两行填充、连点锁、历史、原生事件保留、主题、响应式、超时、清空竞态和设置行为 | 非登录首页；Chrome API 是模拟对象，代理没有真的启用 |
| 分支／诊断渲染 | 9 | 本包 page-hook 与设置面板运行于 Chromium，播放器身份、fetch、剪贴板为明确模拟；检查当前／预取／未缓存／回首分支、音轨参数、脱敏与复制回退 | 非真实互动视频服务或浏览器权限链验证 |
| 合成媒体 MSE | 7 | 真实 MediaSource 解码本地合成 H.264／AAC；真实 Range 组装、SIDX、追加、缓冲外 seek、2× 继续播放与销毁 | 数据由内存 fetch 模拟返回；无真实 CDN、B 站 UI、HDR 屏幕验证 |
| **合计** | **108** | 所列检查均完成，无该轮未捕获异常 | 不等于 108 个真实账号场景 |

原始输出分别为 tests/core-results.tap、browser-dom-results.json、engine-browser-results.json、media-results.json。本包不沿用 1.0.0 的性能基准结果为 1.1.0 背书；benchmark.cjs 保留为可选开发工具，未作本次速度结论依据。

## 关键覆盖

首页：原 2×2 轮播占位与 nth-child 间距消除；10 张已加载卡片在合成的五列布局中填成两行；工具栏不遮挡；保留原生 hover 按钮的原监听器。连续三次同步点击只调用一次原生刷新。前后回看不请求新推荐；同批追加不增加批次；部分列表未达条件时不提前提交。

主题：旧强制深色迁移为原生；默认不改原生颜色；OLED 设置使主要测试背景等于 rgb(0,0,0)；原生切浅色后解除黑色覆盖。5／4／3／2 列布局、广告规则优先级、总开关撤销和 SPA 离开／返回有检查。

失败：10 秒无变化超时解锁；原生按钮失配不重载；推荐区域重建只挂一条操作栏；清空 epoch 阻止旧写入复活；存储失败不破坏当前页面；剪贴板失败提供手动复制。

内核：原生 MSE 开放但 SourceBuffer 未齐时等待，最多 1 秒；同一源完成或关闭后结束等待；只在接管期间拦截特定编码失败标记；原生音轨参数传到接管工厂并遵守编码支持；互动下一分支不误复用首段地址；预取分支不打断当前播放。

## 尚未完成

尝试加载实际扩展时未获得扩展 worker；扩展管理页及真实 B 站导航返回 ERR_BLOCKED_BY_ADMINISTRATOR。本环境没有完成真实扩展安装、MAIN／ISOLATED 注入、原生扩展存储联动和登录 B 站 E2E，未尝试绕过管理策略。不能声称这些项目已通过。

本地渲染测试明确通过 set_content 与 fixture location／Chrome API shim 运行，不伪装为访问了真实 B 站。截图中的推荐卡片均为测试内容，不是用户推荐数据。

真实 HDR／杜比／Hi-Res 是否可播还受账号授权、浏览器编码支持和硬件影响；本次只验证适用逻辑，不保证目标设备能力。未量测海外网络加速提升或长期真实站点内存。

## 复现

从包根目录运行核心测试：

```sh
node --test tests/core.test.cjs tests/update.test.cjs
```

浏览器测试需要 Python Playwright 和可用 Chromium。设置 CHROMIUM_PATH 为本机 Chromium 可执行文件；脚本默认路径仅适用于本次 Linux 环境。然后运行：

```sh
python tests/browser-dom.py
python tests/engine-browser.py
python tests/media-smoke.py
```

tests/fixtures 下附有由 FFmpeg 生成的合成测试图像与正弦音媒体；重新生成可运行 `bash tests/generate-fixtures.sh`（需 FFmpeg 的 libx264 与 AAC 编码器）。不要对真实账号或真实代理执行模拟器之外的断言。本包不会自动运行测试。
