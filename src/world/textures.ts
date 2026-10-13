import * as THREE from 'three';
import { createRng } from '../logic/rng';

function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return { c, g: c.getContext('2d')! };
}

function tex(c: HTMLCanvasElement, srgb = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 4;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

export interface FacadeTextures {
  map: THREE.CanvasTexture;
  emissive: THREE.CanvasTexture;
  /** world size of one texture tile in metres (x, y) */
  tile: [number, number];
}

/** Punched-window facade: concrete/stone with a 4x4 window grid per tile. */
export function makeFacade(style: 'concrete' | 'brick' | 'glass' | 'tower', seed: number): FacadeTextures {
  const rng = createRng(seed);
  const S = 256;
  const { c, g } = canvas(S, S);
  const { c: ec, g: eg } = canvas(S, S);
  const cols = 4;
  const rows = 4;
  const cw = S / cols;
  const rh = S / rows;
  eg.fillStyle = '#000';
  eg.fillRect(0, 0, S, S);

  if (style === 'glass' || style === 'tower') {
    const base = style === 'glass' ? '#5d86a8' : '#3b4a6b';
    g.fillStyle = base;
    g.fillRect(0, 0, S, S);
    // subtle vertical gradient banding
    for (let y = 0; y < S; y += 2) {
      g.fillStyle = `rgba(255,255,255,${0.03 + 0.03 * Math.sin(y * 0.09)})`;
      g.fillRect(0, y, S, 1);
    }
    // mullions
    g.fillStyle = style === 'glass' ? '#1f2c3d' : '#171d2c';
    for (let x = 0; x <= cols; x++) g.fillRect(x * cw - 2, 0, 4, S);
    for (let y = 0; y <= rows; y++) g.fillRect(0, y * rh - 2, S, 4);
    // spandrel strips (every other row) give the tower rhythm
    for (let y = 0; y < rows; y++) {
      if (y % 2 === 1) {
        g.fillStyle = style === 'glass' ? 'rgba(20,30,45,0.55)' : 'rgba(10,14,25,0.6)';
        g.fillRect(0, y * rh + rh * 0.72, S, rh * 0.28);
      }
    }
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        if (rng.chance(style === 'glass' ? 0.35 : 0.45)) {
          const warm = rng.chance(0.7);
          eg.fillStyle = warm ? `rgba(255,${200 + rng.int(0, 40)},${120 + rng.int(0, 60)},${0.5 + rng.next() * 0.5})` : `rgba(180,220,255,${0.4 + rng.next() * 0.5})`;
          eg.fillRect(x * cw + 4, y * rh + 4, cw - 8, rh * 0.68 - 6);
        }
      }
    }
  } else {
    const base = style === 'brick' ? '#9a5d48' : '#b8ad9c';
    g.fillStyle = base;
    g.fillRect(0, 0, S, S);
    // grain
    for (let i = 0; i < 1800; i++) {
      g.fillStyle = `rgba(${rng.chance(0.5) ? 255 : 0},${rng.chance(0.5) ? 255 : 0},${rng.chance(0.5) ? 255 : 0},0.04)`;
      g.fillRect(rng.int(0, S), rng.int(0, S), 2, 2);
    }
    if (style === 'brick') {
      g.fillStyle = 'rgba(60,30,20,0.35)';
      for (let y = 0; y < S; y += 8) {
        g.fillRect(0, y, S, 1);
        const off = (y / 8) % 2 === 0 ? 0 : 8;
        for (let x = off; x < S; x += 16) g.fillRect(x, y, 1, 8);
      }
    }
    // floor bands
    g.fillStyle = 'rgba(0,0,0,0.12)';
    for (let y = 0; y < rows; y++) g.fillRect(0, y * rh + rh - 6, S, 6);
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const wx = x * cw + cw * 0.22;
        const wy = y * rh + rh * 0.18;
        const ww = cw * 0.56;
        const wh = rh * 0.6;
        // frame
        g.fillStyle = 'rgba(40,36,34,0.9)';
        g.fillRect(wx - 3, wy - 3, ww + 6, wh + 6);
        g.fillStyle = `rgb(${40 + rng.int(0, 30)},${56 + rng.int(0, 30)},${80 + rng.int(0, 30)})`;
        g.fillRect(wx, wy, ww, wh);
        g.fillStyle = 'rgba(255,255,255,0.18)';
        g.fillRect(wx, wy, ww * 0.45, wh * 0.4);
        // sill
        g.fillStyle = 'rgba(255,255,255,0.22)';
        g.fillRect(wx - 4, wy + wh + 2, ww + 8, 3);
        if (rng.chance(0.4)) {
          eg.fillStyle = `rgba(255,${190 + rng.int(0, 50)},${110 + rng.int(0, 60)},${0.6 + rng.next() * 0.4})`;
          eg.fillRect(wx, wy, ww, wh);
        }
      }
    }
  }
  const tile: [number, number] = style === 'glass' || style === 'tower' ? [12, 14.4] : [13, 14];
  return { map: tex(c), emissive: tex(ec), tile };
}

export function makeRoofTexture(seed: number): THREE.CanvasTexture {
  const rng = createRng(seed);
  const S = 128;
  const { c, g } = canvas(S, S);
  g.fillStyle = '#6e6760';
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 2600; i++) {
    const v = rng.int(80, 140);
    g.fillStyle = `rgba(${v},${v - 6},${v - 12},0.5)`;
    g.fillRect(rng.int(0, S), rng.int(0, S), 1, 1);
  }
  g.fillStyle = 'rgba(0,0,0,0.12)';
  for (let i = 0; i < 6; i++) g.fillRect(0, rng.int(0, S), S, 1);
  return tex(c);
}

/** One city block pitch (street + sidewalks + lot) as a tiling ground texture. */
export function makeStreetTexture(): THREE.CanvasTexture {
  const S = 512;
  const { c, g } = canvas(S, S);
  const street = (16 / 72) * S; // street width in px
  // lot
  g.fillStyle = '#75716b';
  g.fillRect(0, 0, S, S);
  // sidewalk ring
  g.fillStyle = '#a19a8e';
  g.fillRect(street / 2 - 20, street / 2 - 20, S - street + 40, S - street + 40);
  g.fillStyle = '#6c665e';
  g.fillRect(street / 2 + 10, street / 2 + 10, S - street - 20, S - street - 20);
  // asphalt cross
  g.fillStyle = '#2f3034';
  g.fillRect(0, 0, S, street / 2 - 20);
  g.fillRect(0, S - street / 2 + 20, S, street / 2 - 20);
  g.fillRect(0, 0, street / 2 - 20, S);
  g.fillRect(S - street / 2 + 20, 0, street / 2 - 20, S);
  // lane lines
  g.strokeStyle = '#d9c35a';
  g.lineWidth = 3;
  g.setLineDash([18, 14]);
  g.beginPath();
  g.moveTo(0, 0.5);
  g.lineTo(S, 0.5);
  g.moveTo(0.5, 0);
  g.lineTo(0.5, S);
  g.stroke();
  g.setLineDash([]);
  // crosswalk stripes
  g.fillStyle = 'rgba(255,255,255,0.7)';
  for (let i = 0; i < 6; i++) {
    g.fillRect(street / 2 - 18, street / 2 + 24 + i * 12, 14, 6);
    g.fillRect(S - street / 2 + 4, street / 2 + 24 + i * 12, 14, 6);
    g.fillRect(street / 2 + 24 + i * 12, street / 2 - 18, 6, 14);
    g.fillRect(street / 2 + 24 + i * 12, S - street / 2 + 4, 6, 14);
  }
  // sidewalk seams
  g.strokeStyle = 'rgba(0,0,0,0.15)';
  g.lineWidth = 1;
  for (let i = 0; i < S; i += 24) {
    g.beginPath();
    g.moveTo(i, street / 2 - 20);
    g.lineTo(i, street / 2 + 10);
    g.moveTo(i, S - street / 2 - 10);
    g.lineTo(i, S - street / 2 + 20);
    g.stroke();
  }
  const t = tex(c);
  t.anisotropy = 8;
  return t;
}

export function makeBillboardTexture(seed: number, text: string, sub: string, bg: string, fg: string): THREE.CanvasTexture {
  const rng = createRng(seed);
  const { c, g } = canvas(512, 256);
  g.fillStyle = bg;
  g.fillRect(0, 0, 512, 256);
  // diagonal stripe
  g.fillStyle = 'rgba(255,255,255,0.12)';
  g.beginPath();
  g.moveTo(300, 0);
  g.lineTo(512, 0);
  g.lineTo(512, 140);
  g.closePath();
  g.fill();
  g.fillStyle = fg;
  g.font = 'bold 86px Impact, "Arial Black", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 256, 105);
  g.font = 'bold 34px "Arial Narrow", Arial, sans-serif';
  g.fillStyle = 'rgba(255,255,255,0.85)';
  g.fillText(sub, 256, 185);
  for (let i = 0; i < 4; i++) {
    g.fillStyle = 'rgba(255,255,255,0.5)';
    g.beginPath();
    g.arc(30 + i * 150 + rng.int(0, 10), 30, 6, 0, Math.PI * 2);
    g.fill();
  }
  g.strokeStyle = 'rgba(0,0,0,0.5)';
  g.lineWidth = 10;
  g.strokeRect(0, 0, 512, 256);
  const t = tex(c);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

export function makeNeonSignTexture(text: string, color: string): THREE.CanvasTexture {
  const { c, g } = canvas(128, 512);
  g.fillStyle = '#1b1520';
  g.fillRect(0, 0, 128, 512);
  g.strokeStyle = color;
  g.lineWidth = 6;
  g.strokeRect(8, 8, 112, 496);
  g.fillStyle = color;
  g.font = 'bold 72px Impact, "Arial Black", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const chars = text.split('');
  const step = Math.min(78, 460 / chars.length);
  chars.forEach((ch, i) => g.fillText(ch, 64, 40 + step * (i + 0.5)));
  const t = tex(c);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

export function makeFenceTexture(): THREE.CanvasTexture {
  const { c, g } = canvas(64, 64);
  g.clearRect(0, 0, 64, 64);
  g.strokeStyle = 'rgba(210,215,225,0.95)';
  g.lineWidth = 2.5;
  g.beginPath();
  for (let i = -64; i < 128; i += 16) {
    g.moveTo(i, 0);
    g.lineTo(i + 64, 64);
    g.moveTo(i + 64, 0);
    g.lineTo(i, 64);
  }
  g.stroke();
  const t = tex(c);
  return t;
}

/**
 * Equirectangular baseball texture: cream leather with the two red horseshoe seams traced from the classic parametric seam
 * curve, so when the sphere really rotates the seams sweep across its face and the spin axis is unmistakable.
 */
export function makeBallTexture(): THREE.CanvasTexture {
  const W = 512;
  const H = 256;
  const { c, g } = canvas(W, H);
  g.fillStyle = '#fbf3e4';
  g.fillRect(0, 0, W, H);
  // leather grain
  const rng = createRng(31);
  for (let i = 0; i < 1600; i++) {
    g.fillStyle = `rgba(120,90,60,${0.03 + rng.next() * 0.05})`;
    g.fillRect(rng.int(0, W), rng.int(0, H), 2, 2);
  }
  const alpha = 0.42;
  const pts: { u: number; v: number }[] = [];
  const N = 720;
  for (let i = 0; i <= N; i++) {
    const t = (i / N) * Math.PI * 2;
    const phi = Math.PI / 2 - (Math.PI / 2 - alpha) * Math.cos(t);
    const theta = t / 2 + alpha * Math.sin(2 * t);
    const x = Math.sin(phi) * Math.cos(theta);
    const y = Math.sin(phi) * Math.sin(theta);
    const z = Math.cos(phi);
    const u = (Math.atan2(z, x) / (Math.PI * 2) + 0.5) * W;
    const v = (Math.acos(Math.max(-1, Math.min(1, y))) / Math.PI) * H;
    pts.push({ u, v });
  }
  const drawSeam = (width: number, color: string) => {
    g.strokeStyle = color;
    g.lineWidth = width;
    g.lineCap = 'round';
    g.beginPath();
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const q = pts[Math.max(0, i - 1)];
      if (i === 0 || Math.abs(p.u - q.u) > W / 2) g.moveTo(p.u, p.v);
      else g.lineTo(p.u, p.v);
    }
    g.stroke();
  };
  drawSeam(9, 'rgba(120,40,30,0.35)');
  drawSeam(5, '#c8322b');
  // stitches: short red dashes across the seam
  g.strokeStyle = '#a7261f';
  g.lineWidth = 2.2;
  for (let i = 0; i < pts.length - 8; i += 9) {
    const p = pts[i];
    const q = pts[i + 4];
    if (Math.abs(p.u - q.u) > W / 2) continue;
    const dx = q.u - p.u;
    const dy = q.v - p.v;
    const len = Math.hypot(dx, dy) || 1;
    const nx = (-dy / len) * 7;
    const ny = (dx / len) * 7;
    g.beginPath();
    g.moveTo(p.u - nx, p.v - ny);
    g.lineTo(p.u + nx, p.v + ny);
    g.stroke();
  }
  const t = tex(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

export interface CellTextures {
  map: THREE.CanvasTexture;
  emissive: THREE.CanvasTexture;
}

/**
 * One modular facade cell (about 8.4 m x 4.8 m): two or three windows and a floor band. `variant` changes which windows
 * are lit so adjacent cells do not repeat in lockstep.
 */
export function makeCellTexture(style: 'brick' | 'concrete' | 'glass' | 'steel', variant: number, repeat = false): CellTextures {
  const rng = createRng(500 + variant * 13 + style.length);
  const W = 256;
  const H = 148;
  const { c, g } = canvas(W, H);
  const { c: ec, g: eg } = canvas(W, H);
  eg.fillStyle = '#000';
  eg.fillRect(0, 0, W, H);
  if (style === 'glass') {
    g.fillStyle = '#5d86a8';
    g.fillRect(0, 0, W, H);
    for (let y = 0; y < H; y += 2) {
      g.fillStyle = `rgba(255,255,255,${0.03 + 0.04 * Math.sin(y * 0.11 + variant)})`;
      g.fillRect(0, y, W, 1);
    }
    g.fillStyle = 'rgba(20,30,45,0.55)';
    g.fillRect(0, H * 0.74, W, H * 0.26);
    g.fillStyle = '#1f2c3d';
    for (let x = 0; x <= 3; x++) g.fillRect((x * W) / 3 - 3, 0, 6, H);
    g.fillRect(0, 0, W, 5);
    g.fillRect(0, H - 5, W, 5);
    g.fillRect(0, H * 0.74 - 2, W, 4);
    for (let x = 0; x < 3; x++) {
      if (rng.chance(0.4)) {
        eg.fillStyle = rng.chance(0.7) ? `rgba(255,${200 + rng.int(0, 40)},${120 + rng.int(0, 60)},${0.5 + rng.next() * 0.5})` : `rgba(180,220,255,${0.4 + rng.next() * 0.5})`;
        eg.fillRect((x * W) / 3 + 6, 6, W / 3 - 12, H * 0.74 - 12);
      }
    }
  } else if (style === 'steel') {
    g.fillStyle = '#2d3444';
    g.fillRect(0, 0, W, H);
    for (let y = 0; y < H; y += 6) {
      g.fillStyle = `rgba(255,255,255,${0.04 + 0.03 * ((y / 6) % 2)})`;
      g.fillRect(0, y, W, 3);
    }
    g.fillStyle = '#1a1f2b';
    g.fillRect(0, 0, W, 6);
    g.fillRect(0, H - 6, W, 6);
    for (let x = 0; x <= 2; x++) g.fillRect((x * W) / 2 - 2, 0, 4, H);
    // vents
    g.fillStyle = 'rgba(0,0,0,0.35)';
    for (let i = 0; i < 2; i++) g.fillRect(W * 0.12 + i * W * 0.5, H * 0.35, W * 0.26, H * 0.3);
    g.fillStyle = 'rgba(255,255,255,0.08)';
    for (let i = 0; i < 2; i++) for (let y = 0; y < 5; y++) g.fillRect(W * 0.12 + i * W * 0.5, H * 0.35 + y * (H * 0.06), W * 0.26, 2);
  } else {
    const base = style === 'brick' ? '#9a5d48' : '#b8ad9c';
    g.fillStyle = base;
    g.fillRect(0, 0, W, H);
    for (let i = 0; i < 1200; i++) {
      g.fillStyle = `rgba(${rng.chance(0.5) ? 255 : 0},${rng.chance(0.5) ? 255 : 0},${rng.chance(0.5) ? 255 : 0},0.045)`;
      g.fillRect(rng.int(0, W), rng.int(0, H), 2, 2);
    }
    if (style === 'brick') {
      g.fillStyle = 'rgba(60,30,20,0.38)';
      for (let y = 0; y < H; y += 7) {
        g.fillRect(0, y, W, 1);
        const off = (y / 7) % 2 === 0 ? 0 : 8;
        for (let x = off; x < W; x += 16) g.fillRect(x, y, 1, 7);
      }
    }
    // floor band
    g.fillStyle = 'rgba(0,0,0,0.14)';
    g.fillRect(0, H - 9, W, 9);
    g.fillStyle = 'rgba(255,255,255,0.12)';
    g.fillRect(0, H - 10, W, 2);
    const cols = 2;
    for (let x = 0; x < cols; x++) {
      const wx = (x * W) / cols + W * 0.1;
      const ww = W / cols - W * 0.2;
      const wy = H * 0.16;
      const wh = H * 0.58;
      g.fillStyle = 'rgba(40,36,34,0.92)';
      g.fillRect(wx - 4, wy - 4, ww + 8, wh + 8);
      g.fillStyle = `rgb(${40 + rng.int(0, 30)},${56 + rng.int(0, 30)},${80 + rng.int(0, 30)})`;
      g.fillRect(wx, wy, ww, wh);
      g.fillStyle = 'rgba(255,255,255,0.2)';
      g.fillRect(wx, wy, ww * 0.45, wh * 0.4);
      g.fillStyle = 'rgba(0,0,0,0.5)';
      g.fillRect(wx + ww / 2 - 2, wy, 4, wh);
      g.fillStyle = 'rgba(255,255,255,0.25)';
      g.fillRect(wx - 6, wy + wh + 3, ww + 12, 4);
      if (rng.chance(0.42)) {
        eg.fillStyle = `rgba(255,${190 + rng.int(0, 50)},${110 + rng.int(0, 60)},${0.6 + rng.next() * 0.4})`;
        eg.fillRect(wx, wy, ww, wh);
      }
    }
  }
  const map = tex(c);
  const emissive = tex(ec);
  const wrap = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  map.wrapS = map.wrapT = wrap;
  emissive.wrapS = emissive.wrapT = wrap;
  return { map, emissive };
}

/** Dim office interior seen through a breached facade: plaster, a dark window on the far wall, ceiling line. */
export function makeInteriorTexture(): THREE.CanvasTexture {
  const { c, g } = canvas(128, 96);
  g.fillStyle = '#4a4038';
  g.fillRect(0, 0, 128, 96);
  g.fillStyle = 'rgba(0,0,0,0.35)';
  g.fillRect(0, 0, 128, 10);
  g.fillRect(0, 86, 128, 10);
  g.fillStyle = '#2a2f3a';
  g.fillRect(24, 24, 36, 40);
  g.fillRect(70, 24, 36, 40);
  g.fillStyle = 'rgba(255,255,255,0.08)';
  for (let i = 0; i < 128; i += 16) g.fillRect(i, 10, 1, 76);
  const t = tex(c);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

/** Raw broken edge of a wall: rubble-coloured with cracks. */
export function makeRawEdgeTexture(style: 'brick' | 'concrete' | 'glass' | 'steel'): THREE.CanvasTexture {
  const rng = createRng(77 + style.length);
  const { c, g } = canvas(64, 64);
  g.fillStyle = style === 'brick' ? '#7d4a3a' : style === 'steel' ? '#3a4150' : '#8d867c';
  g.fillRect(0, 0, 64, 64);
  for (let i = 0; i < 400; i++) {
    g.fillStyle = `rgba(0,0,0,${rng.next() * 0.25})`;
    g.fillRect(rng.int(0, 64), rng.int(0, 64), 2, 2);
  }
  g.strokeStyle = 'rgba(0,0,0,0.4)';
  g.lineWidth = 1.5;
  for (let i = 0; i < 5; i++) {
    g.beginPath();
    g.moveTo(rng.int(0, 64), rng.int(0, 64));
    g.lineTo(rng.int(0, 64), rng.int(0, 64));
    g.stroke();
  }
  return tex(c);
}

/** Cracked overlay colours used to tint damaged cells (instance colour). */
export const CRACKED_TINT = 0x8a7a6a;

export function makeSkyTexture(): THREE.CanvasTexture {
  const { c, g } = canvas(4, 512);
  const grd = g.createLinearGradient(0, 0, 0, 512);
  grd.addColorStop(0, '#1d1540');
  grd.addColorStop(0.3, '#4a3673');
  grd.addColorStop(0.55, '#c95b6a');
  grd.addColorStop(0.72, '#ff8c5a');
  grd.addColorStop(0.86, '#ffc877');
  grd.addColorStop(1, '#ffe0a8');
  g.fillStyle = grd;
  g.fillRect(0, 0, 4, 512);
  const t = tex(c);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

export function makeCloudTexture(seed: number): THREE.CanvasTexture {
  const rng = createRng(seed);
  const { c, g } = canvas(256, 128);
  g.clearRect(0, 0, 256, 128);
  for (let i = 0; i < 26; i++) {
    const x = 40 + rng.next() * 176;
    const y = 50 + rng.next() * 40;
    const r = 18 + rng.next() * 30;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, 'rgba(255,236,220,0.55)');
    grd.addColorStop(1, 'rgba(255,236,220,0)');
    g.fillStyle = grd;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  const t = tex(c);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

export function makeParticleTexture(): THREE.CanvasTexture {
  const { c, g } = canvas(64, 64);
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.4, 'rgba(255,255,255,0.7)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const t = tex(c);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}
