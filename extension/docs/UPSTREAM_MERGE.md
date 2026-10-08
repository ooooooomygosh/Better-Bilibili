# 上游核对与回移记录

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
