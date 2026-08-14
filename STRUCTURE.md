# 架构

```text
client/src/
├── game/
│   ├── OceanWorld.ts      # WebGPU 初始化、场景、循环、资源释放
│   ├── ocean.ts           # Gerstner 采样、海面 TSL 材质与泡沫
│   ├── raft.ts            # 程序化竹筏、绳结、受波姿态
│   ├── environment.ts     # 天空、岛屿、鸟群、船灯
│   └── types.ts           # UI 与世界共享的参数类型
├── components/
│   ├── OceanExperience.tsx # 生命周期安全的 Canvas 宿主
│   └── OceanHud.tsx        # 航仪风格控制层
└── pages/Home.tsx          # 全屏入口与 UI 状态编排
```

渲染内核与 React 解耦。React 只保存控制值和调用世界实例的方法；场景每帧从平滑目标值读取参数。海面 GPU 位移与 CPU 采样共用相同波形数据结构，以保证竹筏运动与视觉一致。

