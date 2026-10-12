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

export function makeBallTexture(): THREE.CanvasTexture {
  const { c, g } = canvas(256, 128);
  g.fillStyle = '#fff6e6';
  g.fillRect(0, 0, 256, 128);
  g.strokeStyle = '#d2322d';
  g.lineWidth = 3;
  const stitch = (cx: number) => {
    g.beginPath();
    g.moveTo(cx, 0);
    g.bezierCurveTo(cx + 40, 40, cx + 40, 88, cx, 128);
    g.stroke();
    for (let i = 0; i < 9; i++) {
      const t = (i + 0.5) / 9;
      const x = cx + 30 * Math.sin(t * Math.PI);
      const y = t * 128;
      g.beginPath();
      g.moveTo(x - 5, y - 4);
      g.lineTo(x + 5, y + 4);
      g.stroke();
    }
  };
  stitch(64);
  stitch(192);
  return tex(c);
}

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
