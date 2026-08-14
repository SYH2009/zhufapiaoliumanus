# 运行说明

本项目的体验入口是 `client/index.html`，使用原生 `type="module"` 加载 `client/src/main.js`。它不引用图片贴图、模型、HDRI、视频、外部字体或远程 API；Three.js 是唯一的图形库依赖，场景与界面均由代码生成。

在项目目录执行 `pnpm dev`，然后访问开发服务器根路径即可运行。生产检查可使用 `pnpm check`，构建可使用 `pnpm build`。支持 WebGPU 的 Chromium 浏览器将启用 `WebGPURenderer`、TSL 五组 Gerstner 波、节点 Bloom 与 ACES；若浏览器不提供 WebGPU，页面会自动切换到 WebGL 兼容渲染并在左上状态区说明。

| 控件 | 行为 |
|---|---|
| SEA STATE | 连续调节五组 Gerstner 波的幅度，以及竹筏、尾流和泡沫的响应。 |
| TIME OF DAY | 调节昼夜循环的起点，海面与天空共享同一太阳方向与色温。 |
| DRIFT SPEED | 调节竹筏的慢速前进与局部尾流节奏。 |
| FRAME CAP | 在 30–60 FPS 之间设定渲染上限；低帧时会自动降低 DPR 以保护性能。 |
| 锁定视角 | 默认将相机固定在竹筏中心；取消后支持鼠标或触控自由环视，且距离与俯仰受限。 |

当标签页不可见时，渲染循环会自动暂停；恢复时会以受限帧间隔继续运行，避免波面与筏体出现时间跳变。
