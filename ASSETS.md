# 资源清单

## 运行时资源政策

本项目严格遵守“零外部资源”要求。运行时**不加载**任何贴图、模型、HDRI、视频、CDN 图像或生成图像；海面、天空、竹筏、岛屿、云、鸟、船灯和标记全部来自代码。

## 艺术方向参考

将生成一张不进入构建产物的视觉参考图，用于验证电影感、昼夜调色和第一人称构图。它仅作为设计参照，不会被上传或被任何代码引用。

| 参考项 | 存储路径 | 用途 | 运行时引用 |
|---|---|---|---|
| 晨昏竹筏构图 | `/manus-storage/ocean-raft-dawn-reference_21b18acf.jpg` | 日落暖金与低地平线构图标定 | 否 |
| 月光漂流构图 | `/manus-storage/ocean-raft-night-reference_fa06b51b.jpg` | 夜间冷银光、船灯与星空标定 | 否 |
| 阴云海况构图 | `/manus-storage/ocean-raft-overcast-reference_ee742717.jpg` | 大尺度涌浪、岛屿与雾层标定 | 否 |
| 罗盘浪环 | `/manus-storage/ocean-raft-mark_b1f082fa.png` | 标志构图研究；网页实际以代码绘制 SVG | 否 |
