// Windshield view (owner: Anaís): three.js scene of runway 35R at dusk, the Andes behind, rendered into
// an offscreen WebGL canvas the cockpit composites under the panel. Camera = pilot's eye.
import * as THREE from 'three';
import type { Sim } from './model';
import { FIELD_ELEVATION_FT } from './model';

const RUNWAY_LENGTH = 3200; // m
const RUNWAY_WIDTH = 45;
const START_Z = -40; // the plane starts just past the threshold, nose to -z
const EYE_HEIGHT = 1.6;
// The windshield shows pitch 1.6× (instruments stay true): at 640×480 a real 7° rotation barely moves the
// horizon, and the VLM must see the nose come up.
const VIEW_PITCH_GAIN = 1.6;

function canvasTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('canvas 2d context unavailable');
  draw(ctx);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function noise(ctx: CanvasRenderingContext2D, w: number, h: number, base: [number, number, number], amp: number) {
  const img = ctx.createImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    const n = (Math.random() - 0.5) * amp;
    img.data[i * 4] = base[0] + n;
    img.data[i * 4 + 1] = base[1] + n;
    img.data[i * 4 + 2] = base[2] + n * 0.8;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

export class OutsideView {
  readonly canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private landingLight: THREE.SpotLight;
  private lightPool: THREE.Mesh;

  constructor(width: number, height: number) {
    this.canvas = document.createElement('canvas');
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, preserveDrawingBuffer: true });
    this.renderer.setSize(width, height, false);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.camera = new THREE.PerspectiveCamera(58, width / height, 0.5, 60000);
    this.camera.rotation.order = 'YXZ';

    const horizon = new THREE.Color('#f0b27a');
    this.scene.fog = new THREE.Fog(horizon, 3000, 26000);
    this.addSky();
    this.addGround();
    this.addRunway();
    this.addMountains();

    this.scene.add(new THREE.HemisphereLight('#ffd9b0', '#3d4a2a', 1.1));
    const sun = new THREE.DirectionalLight('#ffb070', 1.6);
    sun.position.set(-4000, 900, -1500); // low in the west
    this.scene.add(sun);

    this.landingLight = new THREE.SpotLight('#fff6e0', 0, 700, 0.22, 0.6, 1.2);
    this.scene.add(this.landingLight, this.landingLight.target);
    // A visible pool of light on the runway ahead (a spot alone is faint at dusk).
    this.lightPool = new THREE.Mesh(
      new THREE.CircleGeometry(1, 48),
      new THREE.MeshBasicMaterial({
        color: '#fff3d6',
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        map: canvasTexture(128, 128, (ctx) => {
          const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
          g.addColorStop(0, 'rgba(255,255,255,1)');
          g.addColorStop(1, 'rgba(255,255,255,0)');
          ctx.fillStyle = g;
          ctx.fillRect(0, 0, 128, 128);
        }),
      }),
    );
    this.lightPool.rotation.x = -Math.PI / 2;
    this.lightPool.scale.set(14, 70, 1);
    this.scene.add(this.lightPool);
  }

  private addSky() {
    const geometry = new THREE.SphereGeometry(50000, 32, 16);
    const material = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        top: { value: new THREE.Color('#27466e') },
        mid: { value: new THREE.Color('#8fa9c6') },
        bottom: { value: new THREE.Color('#f3b07a') },
      },
      vertexShader: 'varying vec3 vPos; void main(){ vPos = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `uniform vec3 top; uniform vec3 mid; uniform vec3 bottom; varying vec3 vPos;
        void main(){ float h = vPos.y; vec3 c = h > 0.08 ? mix(mid, top, smoothstep(0.08, 0.6, h)) : mix(bottom, mid, smoothstep(-0.02, 0.08, h));
        float west = pow(max(0.0, dot(normalize(vec3(-1.0, 0.0, -0.35)), normalize(vec3(vPos.x, 0.0, vPos.z)))), 6.0) * (1.0 - smoothstep(0.0, 0.25, h));
        gl_FragColor = vec4(c + vec3(0.35, 0.18, 0.05) * west, 1.0); }`,
    });
    this.scene.add(new THREE.Mesh(geometry, material));
  }

  private addGround() {
    const grass = canvasTexture(512, 512, (ctx) => {
      noise(ctx, 512, 512, [86, 98, 52], 38);
      ctx.globalAlpha = 0.18;
      for (let i = 0; i < 90; i++) {
        ctx.fillStyle = i % 2 ? '#a6a060' : '#4b5a2b';
        ctx.beginPath();
        ctx.ellipse(Math.random() * 512, Math.random() * 512, 20 + Math.random() * 60, 8 + Math.random() * 20, Math.random() * 3, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    grass.wrapS = grass.wrapT = THREE.RepeatWrapping;
    grass.repeat.set(400, 400);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(60000, 60000), new THREE.MeshLambertMaterial({ map: grass }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.z = -RUNWAY_LENGTH / 2;
    this.scene.add(ground);
  }

  private addRunway() {
    const asphalt = canvasTexture(256, 256, (ctx) => noise(ctx, 256, 256, [58, 58, 60], 26));
    asphalt.wrapS = asphalt.wrapT = THREE.RepeatWrapping;
    asphalt.repeat.set(4, RUNWAY_LENGTH / 12);
    const runway = new THREE.Mesh(
      new THREE.PlaneGeometry(RUNWAY_WIDTH, RUNWAY_LENGTH),
      new THREE.MeshLambertMaterial({ map: asphalt }),
    );
    runway.rotation.x = -Math.PI / 2;
    runway.position.set(0, 0.02, -RUNWAY_LENGTH / 2);
    this.scene.add(runway);

    const paint = new THREE.MeshLambertMaterial({ color: '#e8e6df' });
    const stripe = (w: number, l: number, x: number, z: number) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, l), paint);
      m.rotation.x = -Math.PI / 2;
      m.position.set(x, 0.04, z);
      this.scene.add(m);
    };
    for (let z = -60; z > -RUNWAY_LENGTH + 40; z -= 60) stripe(0.9, 36, 0, z); // centerline
    stripe(0.9, RUNWAY_LENGTH, -RUNWAY_WIDTH / 2 + 1, -RUNWAY_LENGTH / 2); // edges
    stripe(0.9, RUNWAY_LENGTH, RUNWAY_WIDTH / 2 - 1, -RUNWAY_LENGTH / 2);
    for (let i = 0; i < 6; i++) {
      stripe(1.8, 30, -18 + i * 3, -20); // threshold "piano keys" behind the plane
      stripe(1.8, 30, 3 + i * 3, -20);
    }
    for (const z of [-300, -450]) for (const x of [-9, 9]) stripe(6, 45, x, z); // touchdown / aiming marks

    // Edge lights, lit at dusk.
    const lamp = new THREE.MeshBasicMaterial({ color: '#fff1c4' });
    const lampGeometry = new THREE.SphereGeometry(0.35, 8, 6);
    for (let z = 0; z > -RUNWAY_LENGTH; z -= 60) {
      for (const x of [-RUNWAY_WIDTH / 2 - 1.5, RUNWAY_WIDTH / 2 + 1.5]) {
        const m = new THREE.Mesh(lampGeometry, lamp);
        m.position.set(x, 0.4, z);
        this.scene.add(m);
      }
    }
  }

  private addMountains() {
    // The Andes: a far ridge of flat-shaded peaks with snow, east and north-east of the runway.
    const geometry = new THREE.ConeGeometry(1, 1, 7, 1);
    const rock = new THREE.MeshLambertMaterial({ color: '#6b5c66', flatShading: true });
    const snow = new THREE.MeshLambertMaterial({ color: '#f4ece6', flatShading: true });
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 70; i++) {
      const angle = -0.15 + rand() * 1.9; // from ahead (north) to the right (east)
      const dist = 16000 + rand() * 9000;
      const h = 1600 + rand() * 2600;
      const r = 1800 + rand() * 2600;
      const x = Math.sin(angle) * dist;
      const z = -Math.cos(angle) * dist;
      const peak = new THREE.Mesh(geometry, rock);
      peak.scale.set(r, h, r);
      peak.position.set(x, h / 2 - 40, z);
      peak.rotation.y = rand() * 3;
      this.scene.add(peak);
      if (h > 2600) {
        const cap = new THREE.Mesh(geometry, snow);
        const k = 0.28;
        cap.scale.set(r * k, h * k, r * k);
        cap.position.set(x, h - (h * k) / 2 - 40, z);
        cap.rotation.y = peak.rotation.y;
        this.scene.add(cap);
      }
    }
  }

  render(sim: Sim) {
    const f = sim.flight;
    const agl = ((f.altitudeFt - FIELD_ELEVATION_FT) * 0.3048) || 0;
    const z = START_Z - f.distanceM;
    // A little vibration with the engine running, more on the ground roll.
    const shake = f.engine === 'running' ? (f.onGround ? 0.004 + f.airspeedKt * 0.0002 : 0.0015) : 0;
    this.camera.position.set(Math.sin(f.t * 47) * shake * 2, EYE_HEIGHT + agl, z);
    this.camera.rotation.set(((f.pitchDeg * VIEW_PITCH_GAIN + Math.sin(f.t * 61) * shake * 40) * Math.PI) / 180, 0, 0);

    const lit = sim.controls.landingLight && sim.controls.master;
    this.landingLight.intensity = lit ? 900 : 0;
    this.landingLight.position.set(0, 1.2 + agl, z);
    this.landingLight.target.position.set(0, 0, z - 120);
    (this.lightPool.material as THREE.MeshBasicMaterial).opacity = lit ? Math.max(0, 0.55 - agl / 120) : 0;
    this.lightPool.position.set(0, 0.06, z - 75);
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.renderer.dispose();
  }
}
