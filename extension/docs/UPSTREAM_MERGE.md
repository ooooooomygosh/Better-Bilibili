# 上游核对与回移记录

## 2.7.0 核对：2026-10-23

| 项目 | 本次固定提交 | 处理 |
| --- | --- | --- |
| [Bilibili-thread-ripper](https://github.com/MrTangLuyao/Bilibili-thread-ripper) | `ee3adaa8cc1afbb29a3d7153e1295e09e42b29e2` · 2026.10.19.2 | 从 bbf4d3d 合并适用内核、CDN、剧集、诊断修复；保留 MV3 和本分支观看策略 |
| [BilibiliSponsorBlock](https://github.com/hanydd/BilibiliSponsorBlock) | `14697261ea532a46793443b07ae64cbf1655cc02` | 核对新增惊吓分类、默认静音、时间轴和服务器变化；后两项已有适用实现 |
| [bilibili-cleaner](https://github.com/festoney8/bilibili-cleaner) | `7ba39d77de42c22f2edb32c768fe6d8967c5fcac` · v4.5.14 | 复核轮播和网格规则，补齐 grid-column / grid-row 自动布局 |
| [biliplus](https://github.com/0xlau/biliplus) | `0bd6c26a68e829709ef24b0aaea591257990634c` | 与旧固定基线一致，无新增同步 |

线程撕裂者新增 64 线程档位，但默认上限仍为 32，智能观看策略继续约束实际并发。原生缓冲锁停止时还原，避免双重下载；音视频低缓冲保护覆盖整个会话。中转链接不改写成普通 CDN 路径。番剧 / 影视走兼容接管并保留 DRM / 试看回退，新安装直播加速关闭，升级保留旧状态。上游四组内核、番剧、诊断、缓冲窗口回归随源码保留 MIT 归属。

**未直接搬入的部分：** 用户脚本的 GM 存储与注入适配不适用于 MV3；SponsorBlock 的自动远程规则更新、云端身份迁移、完整设置框架和画中画 UI 不属于本分支的运行架构，不为追齐代码而新增远程执行或权限。cleaner 与 biliplus 仅用于首页规则参考，没有打包它们的完整发行物。

开发工具 Playwright 固定为 1.64.0，CI 使用 Node 24。Actions 固定到 checkout v7.0.1、setup-node v7.1.0、upload-artifact v7.0.2、action-gh-release v3.0.3 对应提交。没有 npm 运行时依赖，不适用 npm audit。

## 历史记录（2026-10-06）

核对日期：2026-10-06。固定版本：2026.10.4.1；固定提交：`bbf4d3dee502a16e424232ae6a51705f52b0e60d`。

这是对既有 BTR Flow 1.0.0 的适用代码回移，不是用官方整包覆盖后假装无差异，也不是作者新发行的 MV3 插件。

## 可追溯来源

| 来源 | 适用变化 | 落点 |
| --- | --- | --- |
| [上游 CHANGELOG](https://github.com/MrTangLuyao/Bilibili-thread-ripper/blob/bbf4d3dee502a16e424232ae6a51705f52b0e60d/CHANGELOG.md) | 版本、发布形式、修复范围核对 | 版本与安装说明 |
| [f8371c7：0.9.4.3](https://github.com/MrTangLuyao/Bilibili-thread-ripper/commit/f8371c7e714e2c9286be281066b2c4b2d3903385) | MediaSource 竞态保护、特定历史错误标记、原生音轨选择 | native-mse-player.js、page-hook.js |
| [fe4a786：自动线程起播提升](https://github.com/MrTangLuyao/Bilibili-thread-ripper/commit/fe4a7866c089245faacf100fba26b00d006f5f0c) | 至少 16 的起播控制器目标、15 秒缓冲回落、30 秒启动阶段、限流约束 | idm-downloader.js；Flow 策略仍可把实际并发限制到更低 |
| [6fc6ce6：诊断与设置](https://github.com/MrTangLuyao/Bilibili-thread-ripper/commit/6fc6ce67d28120725859d3309035e4b28717143a) | GitHub 入口、诊断复制及失败回退 | settings-panel.js、diagnostics-core.js；标识改为实际 MV3 分支 |
| [e61f646：互动分支](https://github.com/MrTangLuyao/Bilibili-thread-ripper/commit/e61f64639989c085b08b66101bf918af93443550) | 以播放器当前 CID 区分分支，正确使用预取缓存 | page-hook.js；engine-browser.py 覆盖五种分支场景 |

上游 `2026.9.27.1` 起不再发行独立扩展。Tampermonkey／Violentmonkey 存储迁移、GM API 和注入适配属于用户脚本发行通道，在本包中不适用。本包保留 `chrome.storage.sync` 和既有 MAIN／ISOLATED 分工；没有同时执行两份加速器，也没有新增自动更新地址。

## 首页参考

- [biliplus clean-home-page.css](https://github.com/0xlau/biliplus/blob/0bd6c26a68e829709ef24b0aaea591257990634c/css/clean-home-page.css)：核对推荐容器、轮播选择器和移除后的间距问题。
- [bilibili-cleaner homepage/basic.scss](https://github.com/festoney8/bilibili-cleaner/blob/15d9bced793487a8c4b0f9e1f7f67c7ccf6f3da9/src/modules/rules/homepage/groups/basic.scss)：核对轮播隐藏后原生卡片数与 nth-child 规则、横幅与导航关系。

首页布局、状态机、存储和快照呈现为本分支独立实现，没有打包这两个项目的发行物或复制其完整模块；不把有许可证约束的第三方实现换名作为自有 MIT 代码。

## 与上传基线的差异

`changes.patch` 仅含 manifest、src、ui、测试源码等文本运行／验证文件相对上传包的差异，不包括报告、生成图片、校验清单或媒体二进制。打包时移除了旧 upstream README／旧变更日志和旧基准结果，以免误导。本次新测试原始输出都在 tests 目录。
