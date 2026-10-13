import * as THREE from 'three';
import { makeCloudTexture, makeSkyTexture } from '../world/textures';

export interface Quality {
  pixelRatio: number;
  shadows: boolean;
  shadowSize: number;
  fragments: number;
  particles: number;
  /** pooled rigid-body debris chunks for building collapses */
  chunks: number;
  /** software / very weak GPU: no shadows, fewer effects */
  lowSpec: boolean;
  /** persistent settled-rubble pieces */
  rubble: number;
}

/** Reads the GPU renderer string (software renderers like SwiftShader/llvmpipe get the low-spec profile). */
function rendererString(): string {
  try {
    const c = document.createElement('canvas');
    const gl = (c.getContext('webgl2') ?? c.getContext('webgl')) as WebGLRenderingContext | null;
    if (!gl) return '';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const s = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return s;
  } catch {
    return '';
  }
}

export function detectQuality(): Quality {
  const mobile = /iPhone|iPad|Android|Mobile/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && window.innerWidth < 1100);
  const gpu = rendererString();
  const lowSpec = /SwiftShader|llvmpipe|Software|Mesa OffScreen/i.test(gpu) || (typeof navigator.hardwareConcurrency === 'number' && navigator.hardwareConcurrency <= 2);
  const dpr = Math.min(window.devicePixelRatio || 1, lowSpec ? 1 : 2);
  return {
    pixelRatio: dpr,
    shadows: !lowSpec,
    shadowSize: mobile ? 1024 : 2048,
    fragments: mobile ? 160 : 320,
    particles: lowSpec ? 300 : mobile ? 420 : 800,
    chunks: lowSpec ? 32 : mobile ? 44 : 64,
    lowSpec,
    rubble: lowSpec ? 1800 : mobile ? 2600 : 4000,
  };
}

export class Renderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly sun: THREE.DirectionalLight;
  readonly quality: Quality;
  private clouds: THREE.Sprite[] = [];
  private frameTimes: number[] = [];
  private scale = 1;
  /** rolling average frame cost in ms (updated every 90 frames) */
  lastAvgMs = 0;
  envMap: THREE.Texture | null = null;

  constructor(canvas: HTMLCanvasElement, quality: Quality) {
    this.quality = quality;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', alpha: false, stencil: false });
    this.renderer.setPixelRatio(quality.pixelRatio);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = quality.shadows;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    this.camera = new THREE.PerspectiveCamera(62, 1, 0.3, 1800);
    this.scene.fog = new THREE.FogExp2(0xe8a07a, 0.0011);

    // Lighting: warm low sun from the front-left, cool sky fill.
    const hemi = new THREE.HemisphereLight(0x8fb6ff, 0x5a3a2a, 0.55);
    this.scene.add(hemi);
    this.sun = new THREE.DirectionalLight(0xffd3a0, 2.4);
    this.sun.position.set(-180, 150, -260);
    this.sun.castShadow = quality.shadows;
    this.sun.shadow.mapSize.set(quality.shadowSize, quality.shadowSize);
    const sc = this.sun.shadow.camera;
    sc.near = 20;
    sc.far = 900;
    sc.left = -200;
    sc.right = 200;
    sc.top = 200;
    sc.bottom = -200;
    this.sun.shadow.bias = -0.0008;
    this.sun.shadow.normalBias = 0.6;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
    const rim = new THREE.DirectionalLight(0x6a8fff, 0.5);
    rim.position.set(200, 80, 200);
    this.scene.add(rim);

    this.buildSky();
    this.resize();
  }

  private buildSky() {
    const skyGeo = new THREE.SphereGeometry(1500, 24, 16);
    const skyMat = new THREE.MeshBasicMaterial({ map: makeSkyTexture(), side: THREE.BackSide, fog: false, depthWrite: false });
    const sky = new THREE.Mesh(skyGeo, skyMat);
    sky.rotation.x = Math.PI; // gradient top→bottom flipped to put warm band at horizon
    sky.renderOrder = -10;
    this.scene.add(sky);

    // Sun disc
    const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0xffe6b0, fog: false, transparent: true, opacity: 0.95, depthWrite: false }));
    sunSprite.position.set(-700, 230, -1150);
    sunSprite.scale.set(120, 120, 1);
    this.scene.add(sunSprite);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0xff9a5a, fog: false, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending }));
    glow.position.copy(sunSprite.position);
    glow.scale.set(520, 520, 1);
    this.scene.add(glow);

    // Drifting clouds
    for (let i = 0; i < 9; i++) {
      const mat = new THREE.SpriteMaterial({ map: makeCloudTexture(100 + i), transparent: true, opacity: 0.8, fog: false, depthWrite: false });
      const s = new THREE.Sprite(mat);
      const z = -700 - i * 90;
      s.position.set(-900 + i * 230, 220 + (i % 3) * 60, z);
      s.scale.set(380 + i * 30, 160, 1);
      this.clouds.push(s);
      this.scene.add(s);
    }

    // Environment reflections from the sky colours.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const envScene = new THREE.Scene();
    const envSky = new THREE.Mesh(skyGeo.clone(), skyMat.clone());
    envSky.rotation.x = Math.PI;
    envScene.add(envSky);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000), new THREE.MeshBasicMaterial({ color: 0x3a2f33 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -40;
    envScene.add(ground);
    this.envMap = pmrem.fromScene(envScene, 0.04).texture;
    this.scene.environment = this.envMap;
    this.scene.environmentIntensity = 0.65;
    pmrem.dispose();
  }

  resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.renderer.setPixelRatio(this.quality.pixelRatio * this.scale);
    this.camera.aspect = w / h;
    // Portrait phones need a taller field of view to keep the city in frame.
    this.camera.fov = w < h ? 70 : 55;
    this.camera.updateProjectionMatrix();
  }

  update(dt: number, elapsed: number): void {
    for (let i = 0; i < this.clouds.length; i++) {
      const c = this.clouds[i];
      c.position.x += dt * (2 + i * 0.4);
      if (c.position.x > 1100) c.position.x = -1100;
    }
    void elapsed;
  }

  /** Adaptive resolution: drop render scale when frames are consistently slow. */
  recordFrame(ms: number): void {
    this.frameTimes.push(ms);
    if (this.frameTimes.length < 90) return;
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    this.lastAvgMs = avg;
    this.frameTimes.length = 0;
    if (avg > 26 && this.scale > 0.6) {
      this.scale = Math.max(0.6, this.scale - 0.15);
      this.resize();
    } else if (avg < 14 && this.scale < 1) {
      this.scale = Math.min(1, this.scale + 0.1);
      this.resize();
    }
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }
}
