/**
 * Ocean Raft Drift — 潮汐航图设计规范
 * 场景优先；控制层贴靠视野边缘；以潮汐铜绿 #48B7B2 标注可交互航仪。
 * 运行时不加载任何贴图、模型、HDRI、视频、字体或生成图片。
 */
import * as THREE from "three/webgpu";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  cameraPosition,
  color,
  cross,
  dot,
  float,
  mix,
  mx_fractal_noise_float,
  normalWorld,
  pass,
  positionLocal,
  positionWorld,
  sin,
  cos,
  smoothstep,
  time,
  uniform,
  vec3,
} from "three/tsl";
import { bloom } from "three/addons/tsl/display/BloomNode.js";

const TAU = Math.PI * 2;
const UP = new THREE.Vector3(0, 1, 0);
const RAFT_EYE = new THREE.Vector3(0, 3.15, 0.92);
const WAVE_BASE = [
  { direction: new THREE.Vector2(0.88, 0.47).normalize(), amplitude: 0.78, wavelength: 56.0, speed: 0.74, steepness: 0.19, phase: 0.4, group: 0.18 },
  { direction: new THREE.Vector2(-0.56, 0.83).normalize(), amplitude: 0.43, wavelength: 31.0, speed: 0.98, steepness: 0.24, phase: 2.1, group: 0.24 },
  { direction: new THREE.Vector2(0.18, -0.98).normalize(), amplitude: 0.24, wavelength: 15.5, speed: 1.36, steepness: 0.21, phase: 4.3, group: 0.3 },
  { direction: new THREE.Vector2(-0.91, -0.36).normalize(), amplitude: 0.10, wavelength: 7.2, speed: 1.96, steepness: 0.18, phase: 1.3, group: 0.38 },
  { direction: new THREE.Vector2(0.96, -0.27).normalize(), amplitude: 0.035, wavelength: 3.1, speed: 2.72, steepness: 0.12, phase: 3.6, group: 0.46 },
];

const byId = (id) => document.getElementById(id);
const dom = {
  canvas: byId("ocean-canvas"),
  loading: byId("loading"),
  loadingDetail: byId("loading-detail"),
  error: byId("error-panel"),
  errorDetail: byId("error-detail"),
  status: byId("renderer-status"),
  fps: byId("fps-value"),
  bloom: byId("bloom-value"),
  sea: byId("sea-state"),
  seaValue: byId("sea-state-value"),
  time: byId("time-of-day"),
  timeValue: byId("time-of-day-value"),
  drift: byId("drift-speed"),
  driftValue: byId("drift-speed-value"),
  cap: byId("frame-cap"),
  capValue: byId("frame-cap-value"),
  lock: byId("lock-view"),
  lockLabel: byId("lock-label"),
};

const settings = {
  seaState: 1.0,
  timeOfDay: 17.35,
  driftSpeed: 0.52,
  frameCap: 60,
  viewLocked: true,
};

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

function expLerpFactor(speed, delta) {
  return 1 - Math.exp(-speed * delta);
}

function oceanSample(x, z, elapsed, seaState) {
  let height = 0;
  let dx = 0;
  let dz = 0;
  let verticalVelocity = 0;
  let tangentX = new THREE.Vector3(1, 0, 0);
  let tangentZ = new THREE.Vector3(0, 0, 1);

  for (const wave of WAVE_BASE) {
    const k = TAU / wave.wavelength;
    const groupPhase = (wave.direction.x * x + wave.direction.y * z) * k * wave.group + elapsed * wave.speed * wave.group + wave.phase;
    const groupEnvelope = 0.78 + Math.sin(groupPhase) * 0.22;
    const amplitude = wave.amplitude * seaState * groupEnvelope;
    const phase = (wave.direction.x * x + wave.direction.y * z) * k + elapsed * wave.speed + wave.phase;
    const s = Math.sin(phase);
    const c = Math.cos(phase);
    const qa = wave.steepness * amplitude;

    height += amplitude * s;
    dx += wave.direction.x * qa * c;
    dz += wave.direction.y * qa * c;
    verticalVelocity += amplitude * wave.speed * c;

    tangentX.x -= wave.direction.x * wave.direction.x * qa * k * s;
    tangentX.y += wave.direction.x * amplitude * k * c;
    tangentX.z -= wave.direction.x * wave.direction.y * qa * k * s;

    tangentZ.x -= wave.direction.x * wave.direction.y * qa * k * s;
    tangentZ.y += wave.direction.y * amplitude * k * c;
    tangentZ.z -= wave.direction.y * wave.direction.y * qa * k * s;
  }

  const normal = new THREE.Vector3().crossVectors(tangentZ, tangentX).normalize();
  return { height, displacementX: dx, displacementZ: dz, verticalVelocity, normal };
}

function createOceanMaterial() {
  const material = new THREE.MeshStandardNodeMaterial();
  material.name = "FiveGerstnerOceanTSL";
  material.transparent = false;
  material.side = THREE.DoubleSide;

  const seaStrength = uniform(1.0);
  const waterOffset = uniform(new THREE.Vector2(0, 0));
  const sunDirection = uniform(new THREE.Vector3(0.1, 0.65, -0.75));
  const sunColor = uniform(new THREE.Vector3(1.0, 0.5, 0.25));
  const dayAmount = uniform(0.8);

  const worldP = positionLocal.add(vec3(waterOffset.x, 0, waterOffset.y));
  let height = float(0);
  let displaceX = float(0);
  let displaceZ = float(0);
  let txX = float(1);
  let txY = float(0);
  let txZ = float(0);
  let tzX = float(0);
  let tzY = float(0);
  let tzZ = float(1);

  for (const wave of WAVE_BASE) {
    const k = TAU / wave.wavelength;
    const groupPhase = worldP.x.mul(wave.direction.x * k * wave.group)
      .add(worldP.z.mul(wave.direction.y * k * wave.group))
      .add(time.mul(wave.speed * wave.group))
      .add(wave.phase);
    const groupEnvelope = sin(groupPhase).mul(0.22).add(0.78);
    const amplitude = float(wave.amplitude).mul(seaStrength).mul(groupEnvelope);
    const phase = worldP.x.mul(wave.direction.x * k)
      .add(worldP.z.mul(wave.direction.y * k))
      .add(time.mul(wave.speed))
      .add(wave.phase);
    const waveSin = sin(phase);
    const waveCos = cos(phase);
    const qa = amplitude.mul(wave.steepness);
    const aqk = qa.mul(k);

    height = height.add(waveSin.mul(amplitude));
    displaceX = displaceX.add(waveCos.mul(qa.mul(wave.direction.x)));
    displaceZ = displaceZ.add(waveCos.mul(qa.mul(wave.direction.y)));

    txX = txX.sub(waveSin.mul(aqk.mul(wave.direction.x * wave.direction.x)));
    txY = txY.add(waveCos.mul(amplitude.mul(k * wave.direction.x)));
    txZ = txZ.sub(waveSin.mul(aqk.mul(wave.direction.x * wave.direction.y)));
    tzX = tzX.sub(waveSin.mul(aqk.mul(wave.direction.x * wave.direction.y)));
    tzY = tzY.add(waveCos.mul(amplitude.mul(k * wave.direction.y)));
    tzZ = tzZ.sub(waveSin.mul(aqk.mul(wave.direction.y * wave.direction.y)));
  }

  const analyticNormal = cross(vec3(tzX, tzY, tzZ), vec3(txX, txY, txZ)).normalize();
  material.positionNode = positionLocal.add(vec3(displaceX, height, displaceZ));
  material.normalNode = analyticNormal;

  const broadNoise = mx_fractal_noise_float(
    vec3(worldP.x.mul(0.012).add(time.mul(0.008)), worldP.z.mul(0.012), time.mul(0.012)),
    4,
    2.02,
    0.5,
  ).mul(0.5).add(0.5);
  const mediumNoise = mx_fractal_noise_float(
    vec3(worldP.x.mul(0.082).sub(time.mul(0.035)), worldP.z.mul(0.082), time.mul(0.04)),
    3,
    2.15,
    0.54,
  ).mul(0.5).add(0.5);
  const fineNoise = mx_fractal_noise_float(
    vec3(worldP.x.mul(0.31).add(time.mul(0.15)), worldP.z.mul(0.31).sub(time.mul(0.1)), time.mul(0.08)),
    3,
    2.2,
    0.5,
  ).mul(0.5).add(0.5);

  const deepWater = vec3(0.003, 0.03, 0.05);
  const shelfWater = vec3(0.008, 0.18, 0.21);
  const brightWater = vec3(0.075, 0.43, 0.44);
  const waterTone = mix(deepWater, shelfWater, broadNoise.mul(0.56).add(dayAmount.mul(0.2)));
  const waterDetail = mix(waterTone, brightWater, mediumNoise.mul(0.11));
  const viewDirection = cameraPosition.sub(positionWorld).normalize();
  const fresnel = float(1).sub(dot(normalWorld, viewDirection).max(0)).pow(4.8);
  const microGlitter = smoothstep(0.44, 0.82, fineNoise).mul(smoothstep(0.3, 0.92, mediumNoise));
  const sunGlitter = dot(normalWorld, sunDirection).max(0).pow(145).mul(microGlitter).mul(2.15);
  const slope = float(1).sub(analyticNormal.y.clamp(0, 1));
  const crestFoam = smoothstep(0.12, 0.31, slope)
    .mul(smoothstep(0.38, 0.96, height))
    .mul(smoothstep(0.58, 0.86, fineNoise))
    .mul(smoothstep(0.42, 1.36, seaStrength))
    .min(0.46);
  const transmissiveCrest = smoothstep(0.24, 1.02, height).mul(sunColor).mul(0.1);
  const foamColor = vec3(0.78, 0.95, 0.91).mul(crestFoam);
  const reflectedSky = sunColor.mul(fresnel.mul(0.28)).add(vec3(0.05, 0.16, 0.19).mul(fresnel));

  material.colorNode = waterDetail
    .add(reflectedSky)
    .add(transmissiveCrest)
    .add(foamColor)
    .add(sunColor.mul(sunGlitter));
  material.roughnessNode = mix(float(0.055), float(0.24), mediumNoise);
  material.metalnessNode = float(0.19);

  return { material, seaStrength, waterOffset, sunDirection, sunColor, dayAmount };
}

function createSkyMaterial(sunDirection, sunColor, dayAmount) {
  const material = new THREE.MeshBasicNodeMaterial();
  material.name = "AnalyticSkyTSL";
  material.side = THREE.BackSide;
  material.depthWrite = false;

  const direction = positionLocal.normalize();
  const horizon = direction.y.mul(0.5).add(0.5).clamp(0, 1);
  const nightZenith = vec3(0.003, 0.009, 0.036);
  const dayZenith = vec3(0.04, 0.21, 0.4);
  const horizonDay = vec3(0.37, 0.68, 0.75);
  const baseSky = mix(nightZenith, dayZenith, dayAmount);
  let skyColor = mix(horizonDay.mul(dayAmount).add(vec3(0.014, 0.03, 0.08)), baseSky, horizon.pow(0.62));

  const sunDot = dot(direction, sunDirection).max(0);
  const halo = sunDot.pow(12).mul(0.7).add(sunDot.pow(68).mul(2.2));
  const disk = smoothstep(0.9981, 0.99975, sunDot).mul(20);
  const cloudNoise = mx_fractal_noise_float(
    direction.mul(4.4).add(vec3(time.mul(0.006), 0, time.mul(0.004))),
    4,
    2.05,
    0.52,
  ).mul(0.5).add(0.5);
  const lowCloudBand = float(1).sub(smoothstep(-0.03, 0.38, direction.y));
  const cloudBandMask = smoothstep(0.54, 0.7, cloudNoise).mul(lowCloudBand);
  const cloudTint = mix(vec3(0.02, 0.035, 0.07), vec3(0.68, 0.41, 0.25), dayAmount);

  skyColor = skyColor.add(sunColor.mul(halo)).add(sunColor.mul(disk)).sub(cloudTint.mul(cloudBandMask).mul(0.2));
  material.colorNode = skyColor;
  return material;
}

function makeBambooMaterial(index) {
  const shades = [0x9b7643, 0xb18c52, 0x82663b, 0xc09a5b, 0x735d37, 0xa77a43];
  return new THREE.MeshStandardMaterial({
    color: shades[index % shades.length],
    roughness: 0.82,
    metalness: 0.0,
    flatShading: false,
  });
}

function createRaft() {
  const raft = new THREE.Group();
  raft.name = "ProceduralBambooRaft";
  const bambooRadius = 0.16;
  const bambooLength = 5.6;
  const bamboos = 11;

  for (let i = 0; i < bamboos; i += 1) {
    const x = (i - (bamboos - 1) / 2) * 0.29;
    const bamboo = new THREE.Group();
    bamboo.position.x = x;
    bamboo.rotation.z = Math.sin(i * 2.1) * 0.015;

    for (let segment = 0; segment < 4; segment += 1) {
      const length = bambooLength / 4 - 0.05;
      const pole = new THREE.Mesh(
        new THREE.CylinderGeometry(bambooRadius * 0.94, bambooRadius, length, 12, 2),
        makeBambooMaterial(i + segment),
      );
      pole.rotation.x = Math.PI / 2;
      pole.position.z = -bambooLength / 2 + length / 2 + segment * (bambooLength / 4);
      pole.position.y = 0.02 + Math.sin(i * 0.7 + segment) * 0.018;
      pole.castShadow = true;
      pole.receiveShadow = true;
      bamboo.add(pole);

      if (segment > 0) {
        const node = new THREE.Mesh(
          new THREE.TorusGeometry(bambooRadius * 1.02, 0.025, 6, 14),
          new THREE.MeshStandardMaterial({ color: 0x6a512e, roughness: 0.74 }),
        );
        node.rotation.x = Math.PI / 2;
        node.position.z = -bambooLength / 2 + segment * (bambooLength / 4);
        node.position.y = 0.02;
        bamboo.add(node);
      }
    }
    raft.add(bamboo);
  }

  const crossBeamMat = new THREE.MeshStandardMaterial({ color: 0x5f4325, roughness: 0.76 });
  const ropeMat = new THREE.MeshStandardMaterial({ color: 0x403223, roughness: 0.98 });
  [-1.78, -0.55, 0.72, 1.92].forEach((z, beamIndex) => {
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.08, 3.4, 10), crossBeamMat);
    beam.rotation.z = Math.PI / 2;
    beam.position.set(0, 0.14, z);
    raft.add(beam);

    const lash = new THREE.Mesh(new THREE.TorusGeometry(1.48, 0.032, 6, 24), ropeMat);
    lash.position.set(0, 0.16, z);
    lash.rotation.z = beamIndex % 2 ? 0.05 : -0.05;
    raft.add(lash);
  });

  const looseRope = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-1.35, 0.17, -2.25),
    new THREE.Vector3(-0.25, 0.26, -2.32),
    new THREE.Vector3(0.8, 0.16, -2.18),
    new THREE.Vector3(1.35, 0.18, -2.05),
  ]);
  raft.add(new THREE.Mesh(new THREE.TubeGeometry(looseRope, 32, 0.025, 6, false), ropeMat));

  return raft;
}

function createIsland(seed, x, z, scale) {
  const group = new THREE.Group();
  group.position.set(x, -2.2, z);
  const rockMaterial = new THREE.MeshStandardMaterial({ color: 0x24483a, roughness: 0.92, flatShading: true });
  const sandMaterial = new THREE.MeshStandardMaterial({ color: 0x927d50, roughness: 1, flatShading: true });
  const dome = new THREE.Mesh(new THREE.IcosahedronGeometry(scale, 2), rockMaterial);
  dome.scale.set(1.8, 0.55, 1.25);
  dome.rotation.y = seed * 0.71;
  group.add(dome);

  const beach = new THREE.Mesh(new THREE.CylinderGeometry(scale * 1.3, scale * 1.65, 0.38, 9), sandMaterial);
  beach.position.y = -scale * 0.14;
  beach.rotation.y = seed;
  group.add(beach);

  const shrubMaterial = new THREE.MeshStandardMaterial({ color: 0x1c3a2a, roughness: 0.98, flatShading: true });
  for (let i = 0; i < 7; i += 1) {
    const a = i * 2.19 + seed;
    const r = scale * (0.35 + (i % 3) * 0.15);
    const shrub = new THREE.Mesh(new THREE.ConeGeometry(0.45 + (i % 2) * 0.18, 1.1 + (i % 3) * 0.22, 5), shrubMaterial);
    shrub.position.set(Math.cos(a) * r, scale * 0.27 + 0.3, Math.sin(a) * r * 0.62);
    shrub.rotation.y = a;
    group.add(shrub);
  }
  return group;
}

function createBirds() {
  const birds = new THREE.Group();
  const material = new THREE.MeshBasicMaterial({ color: 0x10131a, transparent: true, opacity: 0.8, side: THREE.DoubleSide });
  for (let i = 0; i < 11; i += 1) {
    const geometry = new THREE.BufferGeometry();
    const vertices = new Float32Array([-0.25, 0, 0, 0, 0.08, 0, 0.25, 0, 0]);
    geometry.setAttribute("position", new THREE.BufferAttribute(vertices, 3));
    geometry.setAttribute("normal", new THREE.BufferAttribute(new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]), 3));
    const bird = new THREE.Mesh(geometry, material);
    bird.position.set((i - 5) * 1.1, Math.sin(i * 1.7) * 0.32, Math.cos(i * 0.9) * 0.4);
    bird.rotation.z = Math.sin(i * 0.5) * 0.18;
    birds.add(bird);
  }
  return birds;
}

function createWake() {
  const points = [];
  for (let i = 0; i < 72; i += 1) {
    const row = Math.floor(i / 6);
    const lane = (i % 6) - 2.5;
    points.push(lane * 0.17, 0, row * 0.34 + Math.sin(i * 1.9) * 0.08);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));
  const material = new THREE.PointsMaterial({
    color: 0xc7f3df,
    size: 0.07,
    transparent: true,
    opacity: 0.62,
    depthWrite: false,
  });
  const wake = new THREE.Points(geometry, material);
  wake.name = "LocalWakeFoam";
  return wake;
}

class OceanWorld {
  constructor(canvas, callbacks) {
    this.canvas = canvas;
    this.callbacks = callbacks;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(72, 1, 0.1, 1500);
    this.renderer = null;
    this.postProcessing = null;
    this.controls = null;
    this.isWebGPU = false;
    this.clock = new THREE.Clock();
    this.elapsed = 0;
    this.lastRender = 0;
    this.lastMetric = 0;
    this.frameCount = 0;
    this.fpsAccumulator = 0;
    this.currentFps = 60;
    this.qualityDpr = Math.min(window.devicePixelRatio || 1, 1.7);
    this.performanceCooldown = 0;
    this.raft = null;
    this.cameraRig = null;
    this.ocean = null;
    this.sky = null;
    this.birds = null;
    this.wake = null;
    this.ripples = [];
    this.ship = null;
    this.stars = null;
    this.driftPosition = new THREE.Vector3(0, 0, 0);
    this.driftVelocity = new THREE.Vector3(0, 0, 0);
    this.driftHeading = new THREE.Vector3(0.22, 0, -1).normalize();
    this.targetQuaternion = new THREE.Quaternion();
    this.limitedTilt = new THREE.Euler();
    this.buoyancyVelocity = 0;
    this.heaveOffset = 0;
    this.rippleClock = 0;
    this.viewLocked = true;
    this.running = false;
    this.settings = { ...settings };
    this.boundResize = () => this.resize();
    this.boundVisibility = () => this.handleVisibility();
    this.boundFrame = () => this.frame();
  }

  async init() {
    this.callbacks.status("正在检测图形能力…");
    try {
      if (!("gpu" in navigator)) throw new Error("此浏览器未暴露 WebGPU 接口");
      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) throw new Error("未检测到可用的 WebGPU 适配器");
      this.renderer = new THREE.WebGPURenderer({ canvas: this.canvas, antialias: true, powerPreference: "high-performance" });
      await this.renderer.init();
      this.isWebGPU = true;
      this.callbacks.status("WEBGPU · TSL 节点渲染");
    } catch (webGPUError) {
      try {
        // WebGPURenderer owns the TSL WebGL2 backend. Using the classic
        // WebGLRenderer here would leave node materials without a renderer.
        this.renderer = new THREE.WebGPURenderer({ canvas: this.canvas, antialias: true, powerPreference: "high-performance" });
        await this.renderer.init();
        this.isWebGPU = false;
        this.callbacks.status("WEBGPU 不可用 · 已使用 TSL / WEBGL2 兼容模式");
      } catch (fallbackError) {
        throw new Error(`图形初始化失败：${webGPUError.message || fallbackError.message}`);
      }
    }

    this.renderer.setPixelRatio(this.qualityDpr);
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.02;

    this.camera.position.set(0, 0, 0);
    this.camera.rotation.set(-0.12, 0, 0);

    this.setupScene();
    this.setupControls();
    this.resize();
    window.addEventListener("resize", this.boundResize, { passive: true });
    document.addEventListener("visibilitychange", this.boundVisibility);

    if (this.isWebGPU) {
      const scenePass = pass(this.scene, this.camera);
      const sceneColor = scenePass.getTextureNode("output");
      const bloomPass = bloom(sceneColor, 0.34, 0.38, 0.72);
      this.postProcessing = new THREE.PostProcessing(this.renderer);
      // TSL Bloom is resolved here; PostProcessing then uses renderer ACESFilmics
      // for the final output transform, avoiding an extra color-space conversion.
      this.postProcessing.outputNode = sceneColor.add(bloomPass);
    }

    this.running = true;
    this.renderer.setAnimationLoop(this.boundFrame);
  }

  setupScene() {
    const hemisphere = new THREE.HemisphereLight(0x8ab4c7, 0x071019, 1.25);
    this.scene.add(hemisphere);
    this.sunLight = new THREE.DirectionalLight(0xffd3a1, 2.4);
    this.sunLight.castShadow = false;
    this.scene.add(this.sunLight);

    const oceanSetup = createOceanMaterial();
    this.oceanMaterial = oceanSetup;
    const oceanGeometry = new THREE.PlaneGeometry(560, 560, 240, 240);
    // Rotate vertex data, not the mesh: TSL positionLocal.x/z then maps exactly
    // to world X/Z and the analytical Gerstner tangent basis remains coherent.
    oceanGeometry.rotateX(-Math.PI / 2);
    this.oceanGeometry = oceanGeometry;
    this.ocean = new THREE.Mesh(oceanGeometry, oceanSetup.material);
    this.ocean.frustumCulled = false;
    this.ocean.name = "HighDensityGerstnerOcean";
    this.scene.add(this.ocean);

    this.sky = new THREE.Mesh(new THREE.SphereGeometry(520, 48, 32), createSkyMaterial(oceanSetup.sunDirection, oceanSetup.sunColor, oceanSetup.dayAmount));
    this.sky.name = "AnalyticSky";
    this.scene.add(this.sky);

    this.sunDisc = new THREE.Mesh(
      new THREE.SphereGeometry(2.4, 24, 16),
      new THREE.MeshBasicMaterial({ color: 0xffbf77, transparent: true, opacity: 0.98 }),
    );
    this.scene.add(this.sunDisc);

    this.raft = createRaft();
    this.raft.position.y = 0.25;
    this.scene.add(this.raft);
    this.cameraRig = new THREE.Group();
    this.cameraRig.name = "FirstPersonStandingRig";
    this.cameraRig.position.copy(RAFT_EYE);
    this.raft.add(this.cameraRig);
    this.cameraRig.add(this.camera);
    this.camera.position.set(0, 0, 0);
    this.camera.rotation.set(-0.12, 0, 0);

    const islandSpecs = [
      [11, -76, -175, 6.2],
      [17, 113, -241, 9.6],
      [23, -180, -292, 7.1],
    ];
    this.islands = islandSpecs.map(([seed, x, z, size]) => createIsland(seed, x, z, size));
    this.islands.forEach((island) => this.scene.add(island));

    this.birds = createBirds();
    this.scene.add(this.birds);

    this.ship = new THREE.Group();
    const hull = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.14, 0.25), new THREE.MeshBasicMaterial({ color: 0x171719 }));
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.055, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffdba5 }));
    lamp.position.set(0.15, 0.1, 0);
    this.ship.add(hull, lamp);
    this.scene.add(this.ship);

    const starPositions = [];
    for (let i = 0; i < 850; i += 1) {
      const theta = Math.random() * TAU;
      const phi = Math.acos(THREE.MathUtils.randFloat(0.05, 0.88));
      const radius = 410;
      starPositions.push(
        Math.sin(phi) * Math.cos(theta) * radius,
        Math.cos(phi) * radius,
        Math.sin(phi) * Math.sin(theta) * radius,
      );
    }
    const starGeometry = new THREE.BufferGeometry();
    starGeometry.setAttribute("position", new THREE.Float32BufferAttribute(starPositions, 3));
    starGeometry.setAttribute("normal", new THREE.Float32BufferAttribute(new Array(starPositions.length).fill(0).map((_, index) => index % 3 === 1 ? 1 : 0), 3));
    this.stars = new THREE.Points(starGeometry, new THREE.PointsMaterial({ color: 0xc6dcff, size: 0.8, transparent: true, opacity: 0 }));
    this.scene.add(this.stars);

    this.wake = createWake();
    this.scene.add(this.wake);
    for (let i = 0; i < 3; i += 1) {
      const ripple = new THREE.Mesh(
        new THREE.TorusGeometry(0.7 + i * 0.32, 0.012, 5, 40),
        new THREE.MeshBasicMaterial({ color: 0xaee6de, transparent: true, opacity: 0.32 - i * 0.07 }),
      );
      ripple.rotation.x = -Math.PI / 2;
      this.ripples.push(ripple);
      this.scene.add(ripple);
    }
  }

  setupControls() {
    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enabled = false;
    this.controls.enablePan = false;
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.minDistance = 1.2;
    this.controls.maxDistance = 8.5;
    this.controls.minPolarAngle = 0.55;
    this.controls.maxPolarAngle = Math.PI / 2.08;
    this.controls.target.set(0, 0.2, -8);
    // OrbitControls constructs with an immediate lookAt(); restore the locked
    // first-person optic afterward so the default view points beyond the bow.
    this.camera.rotation.set(-0.12, 0, 0);
  }

  setSettings(nextSettings) {
    this.settings = { ...this.settings, ...nextSettings };
  }

  setViewLocked(locked) {
    if (!this.raft || locked === this.viewLocked) return;
    this.viewLocked = locked;
    this.controls.enabled = !locked;
    if (locked) {
      this.cameraRig.attach(this.camera);
      this.camera.position.set(0, 0, 0);
      this.camera.rotation.set(-0.12, 0, 0);
    } else {
      const raftWorld = this.raft.getWorldPosition(new THREE.Vector3());
      this.scene.attach(this.camera);
      this.camera.position.copy(raftWorld).add(new THREE.Vector3(3.6, 2.25, 5.2));
      this.controls.target.copy(raftWorld).add(new THREE.Vector3(0, 0.15, -1.4));
      this.controls.update();
    }
  }

  resize() {
    if (!this.renderer) return;
    this.camera.aspect = window.innerWidth / Math.max(1, window.innerHeight);
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(this.qualityDpr);
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
  }

  handleVisibility() {
    if (!this.renderer) return;
    if (document.hidden) {
      this.renderer.setAnimationLoop(null);
    } else if (this.running) {
      this.clock.getDelta();
      this.renderer.setAnimationLoop(this.boundFrame);
    }
  }

  updateSun() {
    const cycle = ((this.settings.timeOfDay / 24) + this.elapsed * 0.00115) % 1;
    const angle = cycle * TAU - Math.PI / 2;
    const sunDirection = new THREE.Vector3(Math.cos(angle) * 0.62, Math.sin(angle), Math.sin(angle) * 0.72).normalize();
    const daylight = THREE.MathUtils.smoothstep(sunDirection.y, -0.16, 0.18);
    const sunset = Math.exp(-Math.pow(Math.abs(sunDirection.y) * 5.5, 2));
    const warm = new THREE.Color(0xff8760);
    const high = new THREE.Color(0xfff0c5);
    const cold = new THREE.Color(0x91b7e5);
    const sunColor = new THREE.Color().copy(cold).lerp(warm, sunset).lerp(high, daylight * (1 - sunset));

    this.oceanMaterial.seaStrength.value = this.settings.seaState;
    this.oceanMaterial.sunDirection.value.copy(sunDirection);
    this.oceanMaterial.sunColor.value.set(sunColor.r, sunColor.g, sunColor.b);
    this.oceanMaterial.dayAmount.value = daylight;

    const raftWorld = this.raft.getWorldPosition(new THREE.Vector3());
    this.sunLight.position.copy(raftWorld).addScaledVector(sunDirection, 200);
    this.sunLight.color.copy(sunColor);
    this.sunLight.intensity = 0.22 + daylight * 2.9 + sunset * 0.45;
    this.sunDisc.position.copy(raftWorld).addScaledVector(sunDirection, 420);
    this.sunDisc.material.color.copy(sunColor);
    this.sunDisc.material.opacity = 0.25 + daylight * 0.75;
    this.stars.material.opacity = Math.pow(1 - daylight, 2) * 0.88;
    this.ship.children[1].material.color.copy(sunColor).multiplyScalar(1.8 - daylight * 1.35);
    this.ship.visible = daylight < 0.56;
  }

  updateRaft(delta) {
    const speed = 0.12 + this.settings.driftSpeed * 0.66;
    const targetVelocity = this.driftHeading.clone().multiplyScalar(speed);
    this.driftVelocity.lerp(targetVelocity, expLerpFactor(0.62, delta));
    this.driftPosition.addScaledVector(this.driftVelocity, delta);
    this.driftHeading.x += Math.sin(this.elapsed * 0.05) * delta * 0.004;
    this.driftHeading.normalize();

    const forward = this.driftHeading.clone();
    const right = new THREE.Vector3(-forward.z, 0, forward.x).normalize();
    const samplePoint = (forwardOffset, lateralOffset) => this.driftPosition.clone()
      .addScaledVector(forward, forwardOffset)
      .addScaledVector(right, lateralOffset);
    const portBowPoint = samplePoint(2.04, -1.25);
    const starboardBowPoint = samplePoint(2.04, 1.25);
    const portSternPoint = samplePoint(-2.04, -1.25);
    const starboardSternPoint = samplePoint(-2.04, 1.25);
    const portBow = oceanSample(portBowPoint.x, portBowPoint.z, this.elapsed, this.settings.seaState);
    const starboardBow = oceanSample(starboardBowPoint.x, starboardBowPoint.z, this.elapsed, this.settings.seaState);
    const portStern = oceanSample(portSternPoint.x, portSternPoint.z, this.elapsed, this.settings.seaState);
    const starboardStern = oceanSample(starboardSternPoint.x, starboardSternPoint.z, this.elapsed, this.settings.seaState);
    const center = oceanSample(this.driftPosition.x, this.driftPosition.z, this.elapsed, this.settings.seaState);

    const bowHeight = (portBow.height + starboardBow.height) * 0.5;
    const sternHeight = (portStern.height + starboardStern.height) * 0.5;
    const portHeight = (portBow.height + portStern.height) * 0.5;
    const starboardHeight = (starboardBow.height + starboardStern.height) * 0.5;
    const waterForward = forward.clone().multiplyScalar(4.08);
    waterForward.y = bowHeight - sternHeight;
    const waterRight = right.clone().multiplyScalar(2.5);
    waterRight.y = starboardHeight - portHeight;
    const waterNormal = new THREE.Vector3().crossVectors(waterRight, waterForward).normalize();
    if (waterNormal.y < 0) waterNormal.negate();
    const raftZAxis = forward.clone().negate();
    const orientation = new THREE.Matrix4().makeBasis(waterRight.normalize(), waterNormal, raftZAxis);
    this.targetQuaternion.setFromRotationMatrix(orientation);
    this.limitedTilt.setFromQuaternion(this.targetQuaternion, "YXZ");
    this.limitedTilt.x = THREE.MathUtils.clamp(this.limitedTilt.x, -0.18, 0.18);
    this.limitedTilt.z = THREE.MathUtils.clamp(this.limitedTilt.z, -0.2, 0.2);
    this.limitedTilt.y += Math.sin(this.elapsed * 0.085) * 0.012;
    this.targetQuaternion.setFromEuler(this.limitedTilt);

    const averageWaterline = (portBow.height + starboardBow.height + portStern.height + starboardStern.height) * 0.25 + 0.2;
    const displacement = averageWaterline - this.raft.position.y;
    this.buoyancyVelocity += displacement * 15.5 * delta;
    this.buoyancyVelocity *= Math.exp(-4.4 * delta);
    this.raft.position.x = THREE.MathUtils.damp(this.raft.position.x, this.driftPosition.x, 2.0, delta);
    this.raft.position.z = THREE.MathUtils.damp(this.raft.position.z, this.driftPosition.z, 2.0, delta);
    this.raft.position.y += this.buoyancyVelocity * delta;
    this.raft.quaternion.slerp(this.targetQuaternion, expLerpFactor(2.35, delta));
    this.heaveOffset = THREE.MathUtils.damp(this.heaveOffset, THREE.MathUtils.clamp(-this.buoyancyVelocity * 0.055, -0.08, 0.08), 3.2, delta);
    this.cameraRig.position.y = RAFT_EYE.y + this.heaveOffset;

    this.ocean.position.set(this.raft.position.x, -0.03, this.raft.position.z);
    this.oceanMaterial.waterOffset.value.set(this.ocean.position.x, this.ocean.position.z);
    this.sky.position.copy(this.raft.position);
    this.stars.position.copy(this.raft.position);

    const backward = this.driftHeading.clone().multiplyScalar(-1);
    const rightward = new THREE.Vector3(-this.driftHeading.z, 0, this.driftHeading.x);
    const wakeBase = this.raft.position.clone().addScaledVector(backward, 1.8);
    const wakeWater = oceanSample(wakeBase.x, wakeBase.z, this.elapsed, this.settings.seaState);
    this.wake.position.copy(wakeBase);
    this.wake.rotation.y = Math.atan2(rightward.z, rightward.x) - Math.PI / 2;
    this.wake.position.y = wakeWater.height + 0.04;
    this.wake.material.opacity = 0.2 + Math.min(0.35, this.settings.seaState * 0.2) + Math.min(0.15, Math.abs(center.verticalVelocity) * 0.05);

    this.rippleClock += delta * (0.55 + this.settings.driftSpeed);
    this.ripples.forEach((ripple, index) => {
      const phase = (this.rippleClock + index / this.ripples.length) % 1;
      ripple.position.copy(wakeBase).addScaledVector(backward, 0.2 + index * 0.38);
      ripple.position.y = oceanSample(ripple.position.x, ripple.position.z, this.elapsed, this.settings.seaState).height + 0.018;
      ripple.scale.setScalar(0.6 + phase * 1.55);
      ripple.material.opacity = (1 - phase) * 0.2;
    });
  }

  updateEnvironment(delta) {
    const raftWorld = this.raft.position;
    this.birds.position.set(raftWorld.x - 18, 9.5 + Math.sin(this.elapsed * 0.19) * 0.7, raftWorld.z - 120);
    this.birds.rotation.y = this.elapsed * 0.04;
    this.birds.children.forEach((bird, index) => {
      bird.position.y += Math.sin(this.elapsed * 3 + index) * delta * 0.52;
      bird.rotation.z = Math.sin(this.elapsed * 4 + index) * 0.22;
    });

    this.ship.position.set(raftWorld.x + 82, -0.15 + Math.sin(this.elapsed * 0.7) * 0.2, raftWorld.z - 173);
    this.ship.rotation.y = -0.11 + Math.sin(this.elapsed * 0.2) * 0.05;

    this.islands.forEach((island, index) => {
      const base = [[-76, -175], [113, -241], [-180, -292]][index];
      island.position.x = raftWorld.x + base[0];
      island.position.z = raftWorld.z + base[1];
    });

    if (!this.viewLocked) {
      const target = this.raft.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.3, -1.5));
      this.controls.target.lerp(target, expLerpFactor(3, delta));
      this.controls.update();
    }
  }

  updateMetrics(delta, now) {
    this.frameCount += 1;
    this.fpsAccumulator += delta;
    if (this.fpsAccumulator >= 0.7) {
      this.currentFps = Math.round(this.frameCount / this.fpsAccumulator);
      this.frameCount = 0;
      this.fpsAccumulator = 0;
    }
    if (now - this.lastMetric > 350) {
      this.callbacks.metrics(this.currentFps, this.isWebGPU, this.qualityDpr);
      this.lastMetric = now;
    }

    if (this.currentFps < 35 && this.qualityDpr > 1.1 && now > this.performanceCooldown) {
      this.qualityDpr = Math.max(1.1, this.qualityDpr - 0.16);
      this.resize();
      this.performanceCooldown = now + 5000;
    }
  }

  frame() {
    const now = performance.now();
    const capInterval = 1000 / this.settings.frameCap;
    if (now - this.lastRender < capInterval) return;
    this.lastRender = now;

    const delta = Math.min(0.034, Math.max(0.001, this.clock.getDelta()));
    this.elapsed += delta;
    this.updateSun();
    this.updateRaft(delta);
    this.updateEnvironment(delta);
    this.updateMetrics(delta, now);

    if (this.postProcessing) this.postProcessing.render();
    else this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.running = false;
    window.removeEventListener("resize", this.boundResize);
    document.removeEventListener("visibilitychange", this.boundVisibility);
    this.controls?.dispose();
    this.postProcessing?.dispose?.();
    this.oceanGeometry?.dispose();
    this.oceanMaterial?.material.dispose();
    this.renderer?.setAnimationLoop(null);
    this.renderer?.dispose();
  }
}

function setRangeText(element, text) {
  element.textContent = text;
}

function bindControls(world) {
  dom.sea.addEventListener("input", (event) => {
    settings.seaState = Number(event.target.value);
    setRangeText(dom.seaValue, `${settings.seaState.toFixed(2)} M`);
    world.setSettings(settings);
  });
  dom.time.addEventListener("input", (event) => {
    settings.timeOfDay = Number(event.target.value);
    const hours = Math.floor(settings.timeOfDay);
    const minutes = Math.round((settings.timeOfDay - hours) * 60).toString().padStart(2, "0");
    setRangeText(dom.timeValue, `${hours.toString().padStart(2, "0")}:${minutes}`);
    world.setSettings(settings);
  });
  dom.drift.addEventListener("input", (event) => {
    settings.driftSpeed = Number(event.target.value);
    setRangeText(dom.driftValue, `${settings.driftSpeed.toFixed(2)} KT`);
    world.setSettings(settings);
  });
  dom.cap.addEventListener("input", (event) => {
    settings.frameCap = Number(event.target.value);
    setRangeText(dom.capValue, `${settings.frameCap} FPS`);
    world.setSettings(settings);
  });
  dom.lock.addEventListener("change", (event) => {
    settings.viewLocked = event.target.checked;
    dom.lockLabel.textContent = settings.viewLocked ? "第一人称固定" : "自由环视已开启";
    world.setViewLocked(settings.viewLocked);
  });
}

async function startExperience() {
  const world = new OceanWorld(dom.canvas, {
    status: (text) => { dom.status.textContent = text; },
    metrics: (fps, webgpu, dpr) => {
      dom.fps.textContent = `${fps} FPS`;
      dom.bloom.textContent = `${webgpu ? "TSL BLOOM" : "WEBGL SAFE"} · DPR ${dpr.toFixed(1)}`;
    },
  });

  try {
    dom.loadingDetail.textContent = "编织海面、天空与航迹…";
    await world.init();
    bindControls(world);
    dom.loading.classList.add("is-hidden");
  } catch (error) {
    dom.loading.classList.add("is-hidden");
    dom.errorDetail.textContent = error?.message || String(error) || "无法初始化此设备的图形上下文。";
    dom.error.hidden = false;
  }

  window.addEventListener("beforeunload", () => world.dispose(), { once: true });
}

startExperience();
