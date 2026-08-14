# 开发记录

- 体验由 Three.js WebGPURenderer 与 TSL 节点材料优先驱动。
- 用户要求零外部资源，因此生成图只用于确定艺术方向，不作为运行时贴图、模型或背景资源。
- 必须提供浏览器不支持 WebGPU 时的明确说明与功能性回退。
- 已切换为框架无关的原生 ES Modules 入口：`client/index.html` 与 `client/src/main.js`。模板残留的 React 源文件不参与运行时。
- 节点后期链使用 `sceneColor + bloom(sceneColor)`；最终 ACES 由 WebGPU 渲染器的输出变换执行，避免嵌套 `renderOutput` 的色彩空间冲突。
- WebGL 兼容后端会将节点对象与 JavaScript 数字相乘转换为 `NaN`；所有解析切线项均须使用显式 `.mul(常量)`。
- 错误面板初始 `hidden` 属性被高优先级 ID 选择器的 `display: grid` 覆盖；必须显式定义 `#error-panel[hidden] { display: none; }`。
- 第一人称相机使用高于竹节 1.6m 的站立高度，保留少量低头角度，并将受波横摇、纵摇限制在约 10–12°，以防筏体在近景中占满视野。
- 为避免直接将相机挂载至运动筏体时积累局部旋转，第一人称使用固定在竹筏上的独立 `FirstPersonStandingRig`；相机在该节点内保持零局部旋转、朝向筏头负 Z 方向。
- 视觉验证显示甲板遮挡过多，因此将观察高度提高至 3.15m，并把垂直视野扩至 72°；画面核心回到海面和低地平线，保留筏体作为下缘空间参照。
- OrbitControls 在构造时会立刻对默认 target 执行 `lookAt`；即使控件被禁用，也会令第一人称相机意外朝向筏心，必须在控件配置后恢复锁定视角旋转。
- 海面网格的旋转必须烘焙到 `BufferGeometry`，而非 Mesh 变换；这样节点侧 `positionLocal.x/z` 与 CPU 波面采样一致，也避免解析法线出现规则条带。
- 移动端不应为保持画面简洁而隐藏用户明确要求的控制项；将紧凑航仪面板固定于底部并允许其内部滚动，以保持所有滑杆可访问。
- 对 `navigator.gpu` 存在性之外还需请求适配器；有些 Chromium 运行环境公开接口但没有可用设备，直接创建 WebGPURenderer 会产生不必要的兼容后端警告。
- 经典 `WebGLRenderer` 不可渲染该项目的 TSL 节点材质；无适配器时仍需使用 `WebGPURenderer` 的内建 WebGL2 后端，关闭仅 WebGPU 的节点后期即可保留场景可用性。
