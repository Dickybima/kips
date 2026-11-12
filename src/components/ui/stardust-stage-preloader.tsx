"use client"

// Stardust Stage Preloader — a cinematic loading gate in black-and-white
// stipple. While the page loads, a lone star burns at the centre of a
// pixel-art cosmos: a dotted orbit fills clockwise with the progress, warp
// lines stream out of it faster and faster, and dithered planets hang in the
// dark. At 100% every one of those dots takes flight. The core folds into a
// moon, the orbit spreads into its halo, the warp lines trace a proscenium
// arch, and stippled clouds and curtains rise into a moonlit stage, with a
// lone figure on it and the wordmark in the reflection.
//
// One file, React only. Every texture (stars, nebula, planets, moon, clouds,
// curtains, figure, rain, grain) is painted procedurally onto canvas once on
// mount, seeded so it comes out the same every time. The dots live on one
// canvas and are morphed by a single requestAnimationFrame loop; everything
// else moves with scoped CSS. Every rule in the <style> is .ssp- prefixed
// and nothing is fetched.

import * as React from "react"

export interface StardustPalette {
  /** The night: background, and the dark side of the planets. */
  stage: string
  /** Every dot, line and letter. */
  ink: string
  /** Secondary text and the unlit end of gradients. */
  dim: string
}

export interface StardustStagePreloaderProps {
  /** Content revealed once the gate lifts. Ignored while `loop` is set. */
  children?: React.ReactNode
  /** Run forever as a showcase: children are never revealed, onComplete never fires. */
  loop?: boolean
  /**
   * Real loading progress, 0–100. Leave undefined to run the built-in
   * simulated load over `durationMs`. The star waits for 100.
   */
  progress?: number
  /** Length of the simulated load. Defaults to 5200ms. */
  durationMs?: number
  /** Wordmark set under the stage. */
  word?: string
  /** Line under the wordmark. */
  caption?: string
  /** Status lines shown under the counter, one per equal slice of the load. */
  acts?: string[]
  /** Colour overrides, merged over the defaults. */
  palette?: Partial<StardustPalette>
  /** Dot count multiplier. 1 is the default, 0.5 is sparse, 2 is dense. */
  density?: number
  /** The lone figure standing on the stage. Defaults to true. */
  figure?: boolean
  /** Fine rain falling over the stage. Defaults to true. */
  rain?: boolean
  /** Dithered planets around the star while loading. Defaults to true. */
  planets?: boolean
  /** The 000 counter and act line under the star. Defaults to true. */
  counter?: boolean
  /** Face for the wordmark. The default stack never fetches anything. */
  fontFamily?: string
  /** Root height. A definite length, never a percentage. */
  height?: string
  /** Fired once, after the gate has lifted. */
  onComplete?: () => void
  /**
   * Stay on the finished stage until the viewer clicks (or presses Enter or
   * Space) instead of lifting by itself. Ignored while `loop` is set.
   */
  waitForClick?: boolean
  /** Extra root class names. */
  className?: string
}

const DEFAULT_PALETTE: StardustPalette = {
  stage: "#050505",
  ink: "#f2f0ea",
  dim: "#8c8a84",
}

const DEFAULT_ACTS = ["Gathering starlight", "Charting the orbit", "Waking the moon", "Raising the curtain"]

const DISPLAY_STACK = '"Cormorant Garamond", "Playfair Display", Didot, "Bodoni 72", Georgia, "Times New Roman", serif'
const MONO_STACK = '"JetBrains Mono", "SF Mono", ui-monospace, Menlo, Consolas, monospace'

// A four-point star in a 2 × 2 box centred on the origin.
const SPARK = "M0-1C.07-.24.24-.07 1 0 .24.07.07.24 0 1-.07.24-.24.07-1 0-.24-.07-.07-.24 0-1Z"

// Speed lines streaming out of the star, in a 200 × 200 box around it:
// [angle rad, from, to, dash, seconds per dash cycle]. Seeded, not random per mount.
const RAYS = (() => {
  const out: number[][] = []
  let s = 9
  const r = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646
  for (let i = 0; i < 44; i++) {
    const ang = (i / 44) * Math.PI * 2 + (r() - 0.5) * 0.08
    out.push([ang, 22 + r() * 6, 52 + r() * 48, 0.6 + r() * 1.6, 0.6 + r() * 1.2])
  }
  return out
})()

// Pixel planets around the star: [x, y in units of the short side, size, texture, float s].
const PLANETS = [
  [-0.66, 0.3, 0.2, 0, 9],
  [0.78, -0.42, 0.4, 1, 13],
  [-0.44, -0.34, 0.075, 2, 7],
  [0.42, 0.32, 0.11, 3, 11],
] as const

// Sparkles that twinkle over the stage: [x %, y % of the stage box, size, delay s].
const STAGE_SPARKS = [
  [36, 14, 0.026, 0],
  [67, 25, 0.018, 1.4],
  [57, 9, 0.014, 2.3],
  [28, 31, 0.012, 0.7],
  [74, 12, 0.012, 3.1],
] as const

// Sky sparkles, visible in both acts: [x %, y % of the root, size, delay s].
const SKY_SPARKS = [
  [9, 18, 0.03, 0.4],
  [88, 64, 0.036, 1.8],
  [16, 78, 0.022, 2.9],
  [93, 14, 0.018, 1.1],
] as const

// #region timeline
// Pure helpers, lifted out and executed by tests/stardust-stage-preloader.test.mjs.

const clamp01 = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x)

// Surges and stalls like a real load instead of a linear tween. [time, progress] knots.
const KNOTS = [
  [0, 0],
  [0.2, 0.27],
  [0.31, 0.3],
  [0.58, 0.66],
  [0.7, 0.7],
  [1, 1],
]

export function sspSimulated(t: number) {
  if (t <= 0) return 0
  if (t >= 1) return 1
  for (let i = 0; i < KNOTS.length - 1; i++) {
    const a = KNOTS[i]
    const b = KNOTS[i + 1]
    if (t <= b[0]) {
      const local = (t - a[0]) / (b[0] - a[0])
      const eased = 1 - Math.pow(1 - local, 3)
      return a[1] + (b[1] - a[1]) * eased
    }
  }
  return 1
}

export function sspEase(t: number) {
  const x = clamp01(t)
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2
}

// Where one dot is in its flight at global morph progress m. Each dot waits
// out its own delay (at most 0.4), then flies for the remaining 0.6.
export function sspMorph(m: number, delay: number) {
  return clamp01((m - delay) / 0.6)
}

// How lit the orbit dot at position a (0–1, clockwise from twelve) is at progress p.
export function sspRingLit(a: number, p: number) {
  // overshoot by one ramp width, so the last dot is fully lit at exactly 100%
  return clamp01((p * (31 / 30) - a) * 30)
}

// Which status line is showing at progress p.
export function sspAct(p: number, n: number) {
  return Math.max(0, Math.min(n - 1, Math.floor(clamp01(p) * n)))
}

// The stage box and everything placed in it, in root pixels.
export function sspStage(w: number, h: number) {
  const a = Math.min(1.45, Math.max(0.9, w / Math.max(1, h)))
  const H = Math.min(h * 0.74, (w * 0.94) / a)
  const W = H * a
  const x0 = (w - W) / 2
  const y0 = (h - H) / 2 - h * 0.015
  return {
    w,
    h,
    u: Math.min(w, h),
    cx: w / 2,
    cy: h * 0.47,
    x0,
    y0,
    W,
    H,
    left: x0 + W * 0.075,
    right: x0 + W * 0.925,
    spring: y0 + H * 0.36,
    crown: y0 + H * 0.02,
    floor: y0 + H * 0.86,
    moonX: w / 2,
    moonY: y0 + H * 0.22,
    moonR: Math.min(W, H) * 0.066,
  }
}

// A point s (0–1) along the proscenium: up the left column, over the arch,
// down the right column. inset pulls the line inward, for the inner moulding.
export function sspArchPoint(
  st: { left: number; right: number; spring: number; crown: number; floor: number },
  s: number,
  inset: number,
) {
  const left = st.left + inset
  const right = st.right - inset
  const rx = (right - left) / 2
  const ry = st.spring - st.crown - inset
  const cx = left + rx
  const col = st.floor - st.spring
  const arc = (Math.PI * (3 * (rx + ry) - Math.sqrt((3 * rx + ry) * (rx + 3 * ry)))) / 2
  const d = clamp01(s) * (col * 2 + arc)
  if (d <= col) return { x: left, y: st.floor - d }
  if (d <= col + arc) {
    const phi = Math.PI - ((d - col) / arc) * Math.PI
    return { x: cx + rx * Math.cos(phi), y: st.spring - ry * Math.sin(phi) }
  }
  return { x: right, y: st.spring + (d - col - arc) }
}

// Seeded so every mount paints the same sky.
export function sspRng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
// #endregion

type SspStage = ReturnType<typeof sspStage>

// Where the painted pieces sit in the stage box, as fractions of its width
// and height: [left, top-from-floor, width, height]. Shared by the painter,
// so each texture is painted at the size it is shown.
const CLOUDS = [
  [0.02, 0.6, 0.46, 0.6, 0.75, 13],
  [0.52, 0.6, 0.46, 0.6, 0.9, 15],
  [0.14, 0.3, 0.72, 0.3, 0.5, 17],
  [0.06, 0.13, 0.88, 0.15, 1.1, 11],
] as const
const CURTAIN_W = 0.15
const FIGURE_H = 0.16

function sspSizes(st: SspStage, q: number): SspSizes {
  const px = (v: number) => Math.max(8, Math.round(v * q))
  return {
    moon: px(st.moonR * 2),
    clouds: CLOUDS.map(([, , w, h]) => [px(st.W * w), px(st.H * h)]),
    curtain: [px(st.W * CURTAIN_W), px(st.floor - st.spring + st.H * 0.02)],
    figure: [px((st.H * FIGURE_H) / 2), px(st.H * FIGURE_H)],
  }
}

// ---- procedural textures ------------------------------------------------------

interface SspTextures {
  stars: string
  nebula: string
  planets: string[]
  moon: string
  clouds: string[]
  curtain: string
  figure: string
  rain: string
  grain: string
}

function canvas(w: number, h: number) {
  const c = document.createElement("canvas")
  c.width = w
  c.height = h
  return c
}

function ctx(c: HTMLCanvasElement) {
  const g = c.getContext("2d", { willReadFrequently: true })
  if (!g) throw new Error("no 2d context")
  return g
}

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16)

// Smooth value noise on a wrapping grid, summed over octaves.
function makeNoise(seed: number) {
  const rnd = sspRng(seed)
  const N = 64
  const grid = Array.from({ length: N * N }, rnd)
  const at = (x: number, y: number) => grid[(((y % N) + N) % N) * N + (((x % N) + N) % N)]
  const smooth = (t: number) => t * t * (3 - 2 * t)
  const value = (x: number, y: number) => {
    const xi = Math.floor(x)
    const yi = Math.floor(y)
    const fx = smooth(x - xi)
    const fy = smooth(y - yi)
    const a = at(xi, yi) + (at(xi + 1, yi) - at(xi, yi)) * fx
    const b = at(xi, yi + 1) + (at(xi + 1, yi + 1) - at(xi, yi + 1)) * fx
    return a + (b - a) * fy
  }
  return (x: number, y: number) => {
    let sum = 0
    let amp = 0.5
    let f = 1
    for (let o = 0; o < 5; o++) {
      sum += value(x * f, y * f) * amp
      f *= 2
      amp *= 0.5
    }
    return sum / 0.97
  }
}

// Scatter dots wherever a shape is, more of them where tone is high. The
// shape is drawn in white onto a mask; tone gets (x, y, coverage), all 0–1.
function stipple(
  w: number,
  h: number,
  shape: (g: CanvasRenderingContext2D) => void,
  tone: (x: number, y: number, a: number) => number,
  ink: string,
  density: number,
  seed: number,
  under?: string,
) {
  const mask = canvas(w, h)
  const mg = ctx(mask)
  shape(mg)
  const alpha = mg.getImageData(0, 0, w, h).data
  const c = canvas(w, h)
  const g = ctx(c)
  if (under) {
    // a solid backing so the shape hides the stars behind it
    g.drawImage(mask, 0, 0)
    g.globalCompositeOperation = "source-in"
    g.fillStyle = under
    g.fillRect(0, 0, w, h)
    g.globalCompositeOperation = "source-over"
  }
  const rnd = sspRng(seed)
  g.fillStyle = ink
  const count = Math.round(w * h * density)
  for (let k = 0; k < count; k++) {
    const x = rnd() * w
    const y = rnd() * h
    const a = alpha[((y | 0) * w + (x | 0)) * 4 + 3] / 255
    const b = rnd()
    if (a <= 0.004) continue
    if (b > tone(x / w, y / h, a)) continue
    g.globalAlpha = 0.5 + rnd() * 0.5
    const s = rnd() > 0.93 ? 1.6 : 1
    g.fillRect(x, y, s, s)
  }
  g.globalAlpha = 1
  return c
}

function paintStars(ink: string) {
  const n = 512
  const c = canvas(n, n)
  const g = ctx(c)
  const rnd = sspRng(3)
  g.fillStyle = ink
  for (let k = 0; k < 520; k++) {
    const b = rnd()
    g.globalAlpha = 0.15 + b * b * 0.85
    const s = b > 0.985 ? 2 : b > 0.9 ? 1.4 : 1
    const x = rnd() * n
    const y = rnd() * n
    g.fillRect(x, y, s, s)
    if (b > 0.993) {
      g.globalAlpha = 0.5
      g.fillRect(x - 4, y + 0.5, 9, 1)
      g.fillRect(x + 0.5, y - 4, 1, 9)
    }
  }
  return c
}

// A pixel-art nebula: fractal noise, ordered-dithered into four levels.
function paintNebula(ink: string) {
  const w = 320
  const h = 180
  const c = canvas(w, h)
  const g = ctx(c)
  const noise = makeNoise(19)
  const warp = makeNoise(41)
  const rnd = sspRng(23)
  g.fillStyle = ink
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const nx = x / 60
      const ny = y / 60
      const q = noise(nx + warp(nx, ny) * 1.6, ny + warp(nx + 5, ny + 3) * 1.6)
      // a diagonal river of cloud, thinning toward the corners
      const band = 1 - Math.min(1, Math.abs((y / h - 0.5) - (x / w - 0.5) * 0.55) * 2.3)
      let v = (q - 0.42) * 2.4 * (0.35 + band * 0.9)
      v = Math.max(0, Math.min(1, v))
      const level = Math.min(3, Math.floor(v * 3 + BAYER[(y % 4) * 4 + (x % 4)]))
      if (level <= 0) continue
      g.globalAlpha = level === 1 ? 0.22 : level === 2 ? 0.5 : 0.85
      g.fillRect(x, y, 1, 1)
    }
  }
  // pixel stars and a few plus-shaped glints
  for (let k = 0; k < 110; k++) {
    const x = Math.floor(rnd() * w)
    const y = Math.floor(rnd() * h)
    const b = rnd()
    g.globalAlpha = 0.4 + b * 0.6
    g.fillRect(x, y, 1, 1)
    if (b > 0.95) {
      g.globalAlpha = 0.55
      g.fillRect(x - 2, y, 5, 1)
      g.fillRect(x, y - 2, 1, 5)
    }
  }
  g.globalAlpha = 1
  return c
}

// A dithered pixel planet. kind 0: cratered, 1: banded giant, 2: plain, 3: ringed.
function paintPlanet(kind: number, ink: string, stage: string) {
  const n = kind === 1 ? 72 : kind === 0 ? 44 : 26
  const pad = kind === 3 ? Math.round(n * 0.45) : 0
  const W = n + pad * 2
  const c = canvas(W, W)
  const g = ctx(c)
  const rnd = sspRng(61 + kind * 13)
  const r = n / 2 - 0.5
  const craters = Array.from({ length: kind === 0 ? 7 : kind === 2 ? 2 : 0 }, () => ({
    x: (rnd() - 0.5) * 1.3,
    y: (rnd() - 0.5) * 1.3,
    r: 0.1 + rnd() * 0.16,
  }))
  const L = [-0.55, -0.5, 0.67]
  const ring = (x: number, y: number) => {
    // a tilted ring around kind 3, back half hidden behind the disc
    const dx = (x - W / 2) / (n * 0.95)
    const dy = (y - W / 2) / (n * 0.95)
    const ry = dy * Math.cos(0.3) - dx * Math.sin(0.3)
    const rx = dx * Math.cos(0.3) + dy * Math.sin(0.3)
    const e = Math.hypot(rx, ry * 3.6)
    return e > 0.78 && e < 0.98 ? (ry > 0 ? 1 : -1) : 0
  }
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      const nx = (x - W / 2 + 0.5) / r
      const ny = (y - W / 2 + 0.5) / r
      const d2 = nx * nx + ny * ny
      const rg = kind === 3 ? ring(x + 0.5, y + 0.5) : 0
      const th = BAYER[(y % 4) * 4 + (x % 4)]
      if (d2 > 1) {
        if (rg) {
          g.globalAlpha = 1
          g.fillStyle = ink
          if (th < 0.7) g.fillRect(x, y, 1, 1)
        }
        continue
      }
      const nz = Math.sqrt(1 - d2)
      let lam = Math.max(0, nx * L[0] + ny * L[1] + nz * L[2])
      if (kind === 1) lam *= 0.75 + 0.25 * Math.sin(ny * 11 + Math.sin(nx * 3) * 1.4)
      for (const cr of craters) {
        const cd = Math.hypot(nx - cr.x, ny - cr.y)
        if (cd < cr.r) lam *= cd < cr.r * 0.75 ? 0.45 : 1.25
      }
      g.globalAlpha = 1
      g.fillStyle = stage
      g.fillRect(x, y, 1, 1)
      if (rg > 0) {
        g.fillStyle = ink
        if (th < 0.7) g.fillRect(x, y, 1, 1)
        continue
      }
      const v = Math.min(1, lam * 1.15)
      if (v > th) {
        g.fillStyle = ink
        g.globalAlpha = v > 0.8 ? 1 : 0.8
        g.fillRect(x, y, 1, 1)
      }
    }
  }
  g.globalAlpha = 1
  return c
}

function paintMoon(n: number, ink: string, stage: string, density: number) {
  const rnd = sspRng(83)
  const craters = Array.from({ length: 16 }, () => ({
    x: (rnd() - 0.5) * 1.5,
    y: (rnd() - 0.5) * 1.5,
    r: 0.05 + rnd() * rnd() * 0.22,
  }))
  return stipple(
    n,
    n,
    (g) => {
      g.fillStyle = "#fff"
      g.beginPath()
      g.arc(n / 2, n / 2, n / 2 - 2, 0, Math.PI * 2)
      g.fill()
    },
    (x, y) => {
      const nx = x * 2 - 1
      const ny = y * 2 - 1
      const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny))
      let lam = Math.max(0, -0.42 * nx - 0.46 * ny + 0.78 * nz)
      for (const cr of craters) {
        const d = Math.hypot(nx - cr.x, ny - cr.y) / cr.r
        if (d < 1) lam *= d < 0.8 ? 0.6 : 1.15
      }
      return 0.06 + 0.94 * Math.pow(lam, 1.15)
    },
    ink,
    0.95 * density,
    84,
    stage,
  )
}

// A cumulus bank: overlapping puffs, rim-lit from above, stippled.
// profile maps x (0–1) to puff size, so the bank rises where you want it.
function paintCloud(seed: number, w: number, h: number, profile: (x: number) => number, ink: string, stage: string, density: number) {
  const rnd = sspRng(seed)
  const puffs: { x: number; y: number; r: number }[] = []
  for (let k = 0; k < 46; k++) {
    const fx = rnd()
    // puffs shrink toward the canvas edges, so the bank tapers instead of clipping
    const r = Math.min(w * 0.18, fx * w * 0.9, (1 - fx) * w * 0.9, (0.2 + 0.8 * profile(fx)) * h * (0.14 + rnd() * 0.14))
    if (r < 4) continue
    const lift = profile(fx) * (h - r * 2.7) * Math.pow(rnd(), 0.8)
    puffs.push({ x: fx * w, y: Math.max(r * 1.04, h - r * 0.75 - lift), r })
  }
  puffs.sort((a, b) => a.y - b.y)
  const light = canvas(w, h)
  const lg = ctx(light)
  for (const p of puffs) {
    const body = lg.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r)
    body.addColorStop(0, "rgba(34,34,34,1)")
    body.addColorStop(0.74, "rgba(30,30,30,1)")
    body.addColorStop(1, "rgba(30,30,30,0)")
    lg.fillStyle = body
    lg.fillRect(p.x - p.r, p.y - p.r, p.r * 2, p.r * 2)
    lg.save()
    lg.beginPath()
    lg.arc(p.x, p.y, p.r * 0.98, 0, Math.PI * 2)
    lg.clip()
    const hi = lg.createRadialGradient(p.x - p.r * 0.2, p.y - p.r * 0.6, 0, p.x - p.r * 0.2, p.y - p.r * 0.6, p.r * 0.9)
    hi.addColorStop(0, "rgba(255,255,255,1)")
    hi.addColorStop(0.45, "rgba(230,230,230,0.6)")
    hi.addColorStop(1, "rgba(255,255,255,0)")
    lg.fillStyle = hi
    lg.fillRect(p.x - p.r, p.y - p.r, p.r * 2, p.r * 2)
    lg.restore()
  }
  const lum = lg.getImageData(0, 0, w, h).data
  return stipple(
    w,
    h,
    (g) => g.drawImage(light, 0, 0),
    (x, y, a) => {
      const i = (Math.min(h - 1, (y * h) | 0) * w + Math.min(w - 1, (x * w) | 0)) * 4
      const l = lum[i] / 255
      // dense where the light catches, a wisp of dots along the soft edges
      return Math.min(1, Math.pow(l, 2) * 1.5 * a + a * (1 - a) * 0.7 + 0.02)
    },
    ink,
    0.85 * density,
    seed + 1,
    stage,
  )
}

// One stage curtain, hanging from the left; the right one is this mirrored.
function paintCurtain(w: number, h: number, ink: string, stage: string, density: number) {
  return stipple(
    w,
    h,
    (g) => {
      g.fillStyle = "#fff"
      g.beginPath()
      g.moveTo(0, 0)
      g.lineTo(w * 0.9, 0)
      g.bezierCurveTo(w * 0.84, h * 0.45, w * 0.72, h * 0.8, w * 0.98, h * 0.965)
      g.quadraticCurveTo(w * 0.72, h * 1.0, w * 0.46, h * 0.975)
      g.quadraticCurveTo(w * 0.22, h * 0.995, 0, h * 0.97)
      g.closePath()
      g.fill()
    },
    (x, y) => {
      const gx = x / (0.55 + 0.45 * Math.min(1, y * 1.6))
      const fold = 0.5 + 0.5 * Math.sin(gx * Math.PI * 2 * 2.6 + Math.sin(y * 5) * 0.5)
      const edge = Math.max(0, 1 - Math.abs(x - (0.86 - y * 0.12)) * 6)
      const top = Math.min(1, y * 4)
      return (0.08 + 0.62 * fold * fold + 0.3 * edge) * (0.45 + 0.55 * top)
    },
    ink,
    1.05 * density,
    211,
    stage,
  )
}

// A lone figure in a long coat, seen from behind, lit from above.
function paintFigure(w: number, h: number, ink: string, stage: string, density: number) {
  return stipple(
    w,
    h,
    (g) => {
      g.fillStyle = "#fff"
      g.beginPath()
      g.ellipse(w * 0.5, h * 0.15, w * 0.15, h * 0.085, 0, 0, Math.PI * 2)
      g.fill()
      g.beginPath()
      g.moveTo(w * 0.33, h * 0.25)
      g.quadraticCurveTo(w * 0.5, h * 0.215, w * 0.67, h * 0.25)
      g.quadraticCurveTo(w * 0.8, h * 0.28, w * 0.78, h * 0.42)
      g.lineTo(w * 0.86, h * 0.84)
      g.quadraticCurveTo(w * 0.5, h * 0.88, w * 0.14, h * 0.84)
      g.lineTo(w * 0.22, h * 0.42)
      g.quadraticCurveTo(w * 0.2, h * 0.28, w * 0.33, h * 0.25)
      g.fill()
      g.fillRect(w * 0.38, h * 0.83, w * 0.09, h * 0.15)
      g.fillRect(w * 0.53, h * 0.83, w * 0.09, h * 0.15)
      // hands held out, like the girl at the footlights
      g.beginPath()
      g.ellipse(w * 0.17, h * 0.47, w * 0.055, h * 0.03, -0.5, 0, Math.PI * 2)
      g.ellipse(w * 0.83, h * 0.47, w * 0.055, h * 0.03, 0.5, 0, Math.PI * 2)
      g.fill()
    },
    (x, y) => {
      const rim = Math.max(0, 1 - Math.abs(x - 0.5) * 2.4)
      return 0.6 + 0.4 * (1 - y) * (0.5 + rim * 0.5)
    },
    ink,
    2.2 * density,
    307,
    stage,
  )
}

function paintRain(ink: string) {
  const n = 256
  const c = canvas(n, n)
  const g = ctx(c)
  const rnd = sspRng(97)
  g.fillStyle = ink
  for (let k = 0; k < 90; k++) {
    g.globalAlpha = 0.08 + rnd() * 0.3
    const len = 6 + rnd() * 26
    g.fillRect(Math.floor(rnd() * n), rnd() * n, 1, len)
  }
  return c
}

function paintGrain() {
  const n = 160
  const c = canvas(n, n)
  const g = ctx(c)
  const img = g.createImageData(n, n)
  const rnd = sspRng(7)
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.round(rnd() * 255)
    img.data[i] = v
    img.data[i + 1] = v
    img.data[i + 2] = v
    img.data[i + 3] = 30
  }
  g.putImageData(img, 0, 0)
  return c
}

// Synchronous on purpose: toBlob is scheduled into idle time, which a page
// this busy never has. PNG keeps the single-pixel dots crisp.
const toUrl = (c: HTMLCanvasElement) => c.toDataURL("image/png")

interface SspSizes {
  moon: number
  clouds: number[][]
  curtain: number[]
  figure: number[]
}

function paintAll(pal: StardustPalette, density: number, z: SspSizes): SspTextures {
  const { ink, stage } = pal
  const profiles = [
    (x: number) => Math.pow(1 - Math.abs(x - 0.22) / 0.78, 1.6),
    (x: number) => Math.pow(1 - Math.abs(x - 0.78) / 0.78, 1.6),
    (x: number) => 0.35 + 0.65 * Math.sin(x * Math.PI),
    () => 0.4,
  ]
  return {
    stars: toUrl(paintStars(ink)),
    nebula: toUrl(paintNebula(ink)),
    planets: [0, 1, 2, 3].map((k) => toUrl(paintPlanet(k, ink, stage))),
    moon: toUrl(paintMoon(z.moon, ink, stage, density)),
    clouds: z.clouds.map(([w, h], k) => toUrl(paintCloud(401 + k * 31, w, h, profiles[k], ink, stage, density))),
    curtain: toUrl(paintCurtain(z.curtain[0], z.curtain[1], ink, stage, density)),
    figure: toUrl(paintFigure(z.figure[0], z.figure[1], ink, stage, density)),
    rain: toUrl(paintRain(ink)),
    grain: toUrl(paintGrain()),
  }
}

// ---- the dot field ------------------------------------------------------------
// Every dot has a place in the cosmos (computed per frame, since it moves)
// and a place on the stage (computed here, once per size). Roles:
// 0 core → moon, 1 orbit → halo, 2 warp line → arch, 3 star → floor or sky.

interface Field {
  n: number
  role: Uint8Array
  r1: Float32Array
  r2: Float32Array
  r3: Float32Array
  r4: Float32Array
  bx: Float32Array
  by: Float32Array
  ba: Float32Array
  delay: Float32Array
  twist: Float32Array
  size: Float32Array
  depth: Float32Array
  ox: Float32Array
  oy: Float32Array
}

function buildField(st: SspStage, count: number): Field {
  const n = count
  const rnd = sspRng(5)
  const f: Field = {
    n,
    role: new Uint8Array(n),
    r1: new Float32Array(n),
    r2: new Float32Array(n),
    r3: new Float32Array(n),
    r4: new Float32Array(n),
    bx: new Float32Array(n),
    by: new Float32Array(n),
    ba: new Float32Array(n),
    delay: new Float32Array(n),
    twist: new Float32Array(n),
    size: new Float32Array(n),
    depth: new Float32Array(n),
    ox: new Float32Array(n),
    oy: new Float32Array(n),
  }
  const L = [-0.42, -0.46, 0.78]
  const inner = st.W * 0.028
  for (let i = 0; i < n; i++) {
    const q = i / n
    const role = q < 0.22 ? 0 : q < 0.46 ? 1 : q < 0.78 ? 2 : 3
    const r1 = rnd()
    const r2 = rnd()
    const r3 = rnd()
    const r4 = rnd()
    f.role[i] = role
    f.r1[i] = r1
    f.r2[i] = r2
    f.r3[i] = r3
    f.r4[i] = r4
    f.size[i] = 0.9 + Math.pow(r4, 5) * 1.3
    f.depth[i] = st.u * (role === 3 ? 0.012 + r4 * 0.014 : 0.008)
    f.twist[i] = (r3 - 0.5) * 0.7
    let x = 0
    let y = 0
    let a = 0
    if (role === 0) {
      const rr = st.moonR * Math.sqrt(r1) * 0.97
      const ang = r2 * Math.PI * 2
      const nx = (Math.cos(ang) * rr) / st.moonR
      const ny = (Math.sin(ang) * rr) / st.moonR
      const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny))
      const lam = Math.max(0, nx * L[0] + ny * L[1] + nz * L[2])
      x = st.moonX + nx * st.moonR
      y = st.moonY + ny * st.moonR
      a = 0.12 + 0.88 * lam
      f.delay[i] = r4 * 0.15
    } else if (role === 1) {
      const g = r1 + r4 - 1
      const rad = r3 < 0.55 ? st.moonR * (1.5 + g * 0.16) : st.moonR * (2.15 + g * 0.3)
      x = st.moonX + Math.cos(r2 * Math.PI * 2) * rad
      y = st.moonY + Math.sin(r2 * Math.PI * 2) * rad
      a = r3 < 0.55 ? 0.55 : 0.3
      f.delay[i] = 0.08 + r4 * 0.2
    } else if (role === 2) {
      const pt = sspArchPoint(st, r1, r2 < 0.55 ? 0 : inner)
      x = pt.x + (r3 - 0.5) * 2.2
      y = pt.y + (r4 - 0.5) * 2.2
      a = 0.55 + 0.45 * r3
      // the arch is traced from the left column round to the right
      f.delay[i] = 0.12 + r1 * 0.28
    } else if (r3 < 0.5) {
      const spread = (st.right - st.left) * 0.5
      const dx = (r1 - 0.5) * 2
      x = st.cx + dx * spread
      y = st.floor + (r2 - 0.35) * st.H * 0.025 * (0.4 + Math.abs(dx))
      a = 0.15 + 0.7 * Math.pow(1 - Math.abs(dx), 1.5)
      f.delay[i] = 0.2 + r4 * 0.2
    } else {
      x = r1 * st.w
      y = r2 * st.h
      a = 0.1 + 0.55 * Math.pow(r4, 3)
      f.delay[i] = r4 * 0.4
    }
    f.bx[i] = x
    f.by[i] = y
    f.ba[i] = a
  }
  return f
}

// ---- styles -------------------------------------------------------------------

const SSP_CSS = `
.ssp-root {
  position: relative;
  width: 100%;
  overflow: hidden;
  isolation: isolate;
  background: var(--ssp-stage);
  color: var(--ssp-ink);
  font-family: var(--ssp-mono);
  -webkit-tap-highlight-color: transparent;
}
.ssp-root svg, .ssp-root canvas, .ssp-root img { max-width: none; }
.ssp-dest {
  position: absolute;
  inset: 0;
  overflow-y: auto;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.9s ease 0.15s;
}
.ssp-root[data-phase="lift"] .ssp-dest, .ssp-dest[data-active="true"] { opacity: 1; pointer-events: auto; }
.ssp-gate {
  position: absolute;
  inset: 0;
  z-index: 10;
  background: var(--ssp-stage);
  cursor: pointer;
  outline: none;
  user-select: none;
  -webkit-user-select: none;
  transition: opacity 1.1s cubic-bezier(0.7, 0, 0.3, 1) 0.2s;
}
.ssp-root[data-phase="lift"] .ssp-gate { opacity: 0; pointer-events: none; }
.ssp-gate:focus-visible .ssp-frame { box-shadow: inset 0 0 0 1px var(--ssp-dim); }
.ssp-layer { position: absolute; inset: 0; pointer-events: none; }

/* ---- the sky ---- */
.ssp-sky {
  inset: -4%;
  background-image: var(--ssp-stars);
  background-size: 512px 512px;
  opacity: 0.75;
  transform: translate3d(calc(var(--ssp-mx) * -8px), calc(var(--ssp-my) * -6px), 0);
}
.ssp-nebula {
  inset: -6%;
  opacity: 0.3;
  transform: translate3d(calc(var(--ssp-mx) * -16px), calc(var(--ssp-my) * -12px), 0) scale(1);
  transition: opacity 1.8s ease, transform 2.6s cubic-bezier(0.55, 0, 0.2, 1);
}
.ssp-nebula-drift {
  position: absolute;
  inset: 0;
  background-image: var(--ssp-nebula);
  background-size: cover;
  background-position: 50% 50%;
  image-rendering: pixelated;
  animation: ssp-nebula 60s ease-in-out infinite alternate;
}
.ssp-root:not([data-phase="load"]) .ssp-nebula {
  opacity: 0;
  transform: translate3d(calc(var(--ssp-mx) * -16px), calc(var(--ssp-my) * -12px), 0) scale(1.6);
}
.ssp-spark {
  position: absolute;
  display: block;
  fill: var(--ssp-ink);
  filter: drop-shadow(0 0 4px rgba(255, 255, 255, 0.55));
  animation: ssp-twinkle 3.6s ease-in-out infinite;
}
.ssp-skyspark { transform: translate(-50%, -50%); }

/* ---- the cosmos: star, flares, planets ---- */
.ssp-rig {
  position: absolute;
  width: 0;
  height: 0;
  transition: transform 2s cubic-bezier(0.65, 0, 0.25, 1) 0.1s, opacity 1.2s ease 1.1s;
}
.ssp-root:not([data-phase="load"]) .ssp-rig { transform: translate(var(--ssp-dx), var(--ssp-dy)) scale(0.35); opacity: 0; }
.ssp-glow {
  position: absolute;
  left: calc(var(--ssp-u) * -0.32);
  top: calc(var(--ssp-u) * -0.32);
  width: calc(var(--ssp-u) * 0.64);
  height: calc(var(--ssp-u) * 0.64);
  border-radius: 50%;
  background: radial-gradient(closest-side, rgba(255, 255, 255, 0.2), rgba(255, 255, 255, 0.05) 40%, transparent);
  opacity: calc(0.35 + var(--ssp-p) * 0.65);
}
.ssp-flare {
  position: absolute;
  left: calc(var(--ssp-u) * -0.75);
  top: -0.5px;
  width: calc(var(--ssp-u) * 1.5);
  height: 1px;
  background: linear-gradient(90deg, transparent, var(--ssp-ink) 47%, var(--ssp-ink) 53%, transparent);
  opacity: 0.75;
  transform: rotate(var(--a)) scaleX(calc(0.18 + var(--ssp-p) * 0.82));
}
.ssp-flare-b { opacity: 0.4; }
.ssp-core {
  position: absolute;
  left: calc(var(--ssp-u) * -0.06);
  top: calc(var(--ssp-u) * -0.06);
  width: calc(var(--ssp-u) * 0.12);
  height: calc(var(--ssp-u) * 0.12);
  animation: ssp-pulse 2.4s ease-in-out infinite;
}
.ssp-core svg {
  display: block;
  width: 100%;
  height: 100%;
  fill: var(--ssp-ink);
  filter: drop-shadow(0 0 6px rgba(255, 255, 255, 0.9)) drop-shadow(0 0 18px rgba(255, 255, 255, 0.5));
}
.ssp-orbit {
  position: absolute;
  left: calc(var(--ssp-u) * -0.2);
  top: calc(var(--ssp-u) * -0.2);
  width: calc(var(--ssp-u) * 0.4);
  height: calc(var(--ssp-u) * 0.4);
  animation: ssp-spin 16s linear infinite;
}
.ssp-moonlet {
  position: absolute;
  width: 5px;
  height: 5px;
  margin: -2.5px 0 0 -2.5px;
  border-radius: 50%;
  background: var(--ssp-ink);
  box-shadow: 0 0 8px rgba(255, 255, 255, 0.8);
}
.ssp-planet-par {
  position: absolute;
  width: 0;
  height: 0;
  transform: translate3d(calc(var(--ssp-mx) * var(--d) * -1px), calc(var(--ssp-my) * var(--d) * -1px), 0);
}
.ssp-planet {
  position: absolute;
  transition: transform 1.5s cubic-bezier(0.6, 0, 0.9, 0.4), opacity 1.1s ease 0.25s;
}
.ssp-root:not([data-phase="load"]) .ssp-planet {
  transform: translate(calc(var(--vx) * var(--ssp-u) * 0.9), calc(var(--vy) * var(--ssp-u) * 0.9)) scale(2.4);
  opacity: 0;
}
.ssp-planet img {
  display: block;
  width: 100%;
  height: 100%;
  image-rendering: pixelated;
  animation: ssp-float var(--f) ease-in-out infinite alternate;
}

.ssp-rays {
  position: absolute;
  left: calc(var(--ssp-u) * -0.9);
  top: calc(var(--ssp-u) * -0.9);
  width: calc(var(--ssp-u) * 1.8);
  height: calc(var(--ssp-u) * 1.8);
  overflow: visible;
  stroke: var(--ssp-ink);
  stroke-width: 0.22;
  stroke-linecap: round;
  opacity: calc(0.12 + var(--ssp-p) * 0.6);
  -webkit-mask-image: radial-gradient(closest-side, #000 30%, transparent 100%);
  mask-image: radial-gradient(closest-side, #000 30%, transparent 100%);
}
.ssp-rays line { animation: ssp-flow linear infinite; }

/* ---- the dots ---- */
.ssp-dots { position: absolute; left: 0; top: 0; pointer-events: none; }

/* ---- the stage ---- */
.ssp-stage {
  position: absolute;
  pointer-events: none;
  transform-origin: 50% 40%;
  transition: transform 1.6s cubic-bezier(0.7, 0, 0.84, 0), filter 1.6s ease;
}
.ssp-root[data-phase="lift"] .ssp-stage { transform: scale(2.6); filter: blur(6px); }
.ssp-par { position: absolute; inset: 0; }
.ssp-par-far { transform: translate3d(calc(var(--ssp-mx) * -6px), calc(var(--ssp-my) * -4px), 0); }
.ssp-par-mid { transform: translate3d(calc(var(--ssp-mx) * -12px), calc(var(--ssp-my) * -6px), 0); }
.ssp-par-near { transform: translate3d(calc(var(--ssp-mx) * -20px), calc(var(--ssp-my) * -8px), 0); }
.ssp-moon {
  position: absolute;
  border-radius: 50%;
  background-size: 100% 100%;
  opacity: 0;
  transform: scale(0.7);
  transition: opacity 1.4s ease, transform 2.2s cubic-bezier(0.16, 1, 0.3, 1);
}
.ssp-root:not([data-phase="load"]) .ssp-moon { opacity: 1; transform: none; transition-delay: 1.5s; }
.ssp-moonglow {
  position: absolute;
  border-radius: 50%;
  background: radial-gradient(closest-side, rgba(255, 255, 255, 0.16), rgba(255, 255, 255, 0.04) 55%, transparent);
  opacity: 0;
  transition: opacity 2s ease 1.6s;
}
.ssp-root:not([data-phase="load"]) .ssp-moonglow { opacity: 1; }
.ssp-cloud {
  position: absolute;
  opacity: 0;
  transform: translate3d(0, 34%, 0);
  transition: transform 2.4s cubic-bezier(0.16, 1, 0.3, 1), opacity 1.6s ease;
}
.ssp-root:not([data-phase="load"]) .ssp-cloud { opacity: 1; transform: none; transition-delay: var(--w); }
.ssp-cloud-drift, .ssp-curtain-sway { position: absolute; inset: 0; background-image: var(--bg); background-size: 100% 100%; }
.ssp-cloud-drift { animation: ssp-drift var(--f) ease-in-out infinite alternate; }
.ssp-arch {
  position: absolute;
  left: 0;
  top: 0;
  overflow: visible;
  fill: none;
  stroke: var(--ssp-ink);
  stroke-linecap: round;
}
.ssp-draw {
  stroke-dasharray: 1 1;
  stroke-dashoffset: 1;
  transition: stroke-dashoffset 2.4s cubic-bezier(0.65, 0, 0.35, 1);
}
.ssp-root:not([data-phase="load"]) .ssp-draw { stroke-dashoffset: 0; transition-delay: var(--w); }
.ssp-orn { opacity: 0; transition: opacity 1.4s ease; }
.ssp-root:not([data-phase="load"]) .ssp-orn { opacity: 1; transition-delay: 2s; }
.ssp-curtain {
  position: absolute;
  clip-path: inset(0 0 100% 0);
  transition: clip-path 2.2s cubic-bezier(0.65, 0, 0.35, 1);
}
.ssp-curtain-r { transform: scaleX(-1); }
.ssp-root:not([data-phase="load"]) .ssp-curtain { clip-path: inset(0 0 0 0); transition-delay: 1.1s; }
.ssp-curtain-sway { transform-origin: 50% 0; animation: ssp-sway 7s ease-in-out infinite alternate; }
.ssp-figure {
  position: absolute;
  background-size: 100% 100%;
  opacity: 0;
  transform: translateY(8%);
  transition: opacity 1.4s ease, transform 2s cubic-bezier(0.16, 1, 0.3, 1);
}
.ssp-root:not([data-phase="load"]) .ssp-figure { opacity: 1; transform: none; transition-delay: 2.1s; }
.ssp-pool {
  position: absolute;
  border-radius: 50%;
  background: radial-gradient(closest-side, rgba(255, 255, 255, 0.22), rgba(255, 255, 255, 0.05) 50%, transparent);
  opacity: 0;
  transition: opacity 1.6s ease 1.9s;
}
.ssp-root:not([data-phase="load"]) .ssp-pool { opacity: 1; }
.ssp-mirror {
  position: absolute;
  left: 0;
  overflow: hidden;
  opacity: 0.32;
  filter: blur(0.6px);
  -webkit-mask-image: linear-gradient(to bottom, #000, transparent 75%);
  mask-image: linear-gradient(to bottom, #000, transparent 75%);
}
.ssp-mirror-flip { position: absolute; left: 0; }
.ssp-stagespark { opacity: 0; transition: opacity 1s ease; }
.ssp-root:not([data-phase="load"]) .ssp-stagespark { opacity: 1; transition-delay: 2.4s; }

/* ---- weather, lens and film ---- */
.ssp-rain {
  background-image: var(--ssp-rain);
  background-size: 256px 256px;
  opacity: 0;
  transition: opacity 2s ease 1s;
  animation: ssp-rain 0.9s linear infinite;
}
.ssp-root[data-rain="true"]:not([data-phase="load"]) .ssp-rain { opacity: 0.45; }
.ssp-vignette { background: radial-gradient(ellipse at 50% 46%, transparent 42%, rgba(0, 0, 0, 0.82) 100%); }
.ssp-grain {
  inset: -50%;
  opacity: 0.5;
  mix-blend-mode: overlay;
  background-image: var(--ssp-grain);
  background-size: 160px 160px;
  animation: ssp-grain 0.8s steps(5) infinite;
}
.ssp-bar {
  position: absolute;
  left: 0;
  right: 0;
  height: max(26px, calc(var(--ssp-u) * 0.065));
  background: #000;
  z-index: 3;
  transition: transform 1.4s cubic-bezier(0.7, 0, 0.3, 1);
}
.ssp-bar-top { top: 0; transform: translateY(-100%); }
.ssp-bar-bot { bottom: 0; transform: translateY(100%); }
.ssp-root[data-phase="morph"] .ssp-bar, .ssp-root[data-phase="reveal"] .ssp-bar { transform: none; }

/* ---- read-outs ---- */
.ssp-readout {
  position: absolute;
  left: 0;
  right: 0;
  text-align: center;
  pointer-events: none;
  transition: opacity 0.7s ease, transform 1.1s cubic-bezier(0.6, 0, 0.3, 1);
}
.ssp-root:not([data-phase="load"]) .ssp-readout { opacity: 0; transform: translateY(16px); }
.ssp-count {
  margin: 0;
  font-size: max(13px, calc(var(--ssp-u) * 0.026));
  font-weight: 300;
  letter-spacing: 0.5em;
  text-indent: 0.5em;
  font-variant-numeric: tabular-nums;
}
.ssp-act {
  margin: calc(var(--ssp-u) * 0.012) 0 0;
  font-size: max(9px, calc(var(--ssp-u) * 0.0135));
  letter-spacing: 0.34em;
  text-indent: 0.34em;
  text-transform: uppercase;
  color: var(--ssp-dim);
  animation: ssp-act-in 0.9s ease both;
}
.ssp-title {
  position: absolute;
  left: 0;
  right: 0;
  z-index: 2;
  text-align: center;
  pointer-events: none;
}
.ssp-word {
  margin: 0;
  font-family: var(--ssp-display);
  font-size: max(26px, calc(var(--ssp-u) * 0.072));
  font-weight: 400;
  letter-spacing: 0.3em;
  text-indent: 0.3em;
  line-height: 1;
  text-transform: uppercase;
  white-space: nowrap;
}
.ssp-letter {
  display: inline-block;
  color: transparent;
  background: linear-gradient(180deg, var(--ssp-ink) 20%, var(--ssp-dim) 100%);
  -webkit-background-clip: text;
  background-clip: text;
  opacity: 0;
  filter: blur(12px);
  transform: translateY(0.35em) scale(1.15);
}
.ssp-root[data-phase="reveal"] .ssp-letter, .ssp-root[data-phase="lift"] .ssp-letter {
  animation: ssp-letter 1.4s cubic-bezier(0.2, 0.7, 0.2, 1) forwards;
}
.ssp-caption, .ssp-hint {
  margin: calc(var(--ssp-u) * 0.02) 0 0;
  font-size: max(9px, calc(var(--ssp-u) * 0.0145));
  letter-spacing: 0.34em;
  text-indent: 0.34em;
  text-transform: uppercase;
  color: var(--ssp-dim);
  opacity: 0;
  transition: opacity 1.2s ease 1s, letter-spacing 2s cubic-bezier(0.2, 0.7, 0.2, 1) 1s;
}
.ssp-hint { font-size: max(8px, calc(var(--ssp-u) * 0.012)); transition-delay: 2.2s; }
.ssp-root[data-phase="reveal"] .ssp-caption { opacity: 1; letter-spacing: 0.44em; }
.ssp-root[data-phase="reveal"] .ssp-hint { opacity: 0.7; animation: ssp-breathe 2.6s ease-in-out 3s infinite; }
.ssp-veil {
  position: absolute;
  inset: 0;
  z-index: 6;
  background: var(--ssp-stage);
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.75s ease;
}
.ssp-veil[data-on="true"] { opacity: 1; }
.ssp-frame { position: absolute; inset: 0; z-index: 7; pointer-events: none; }
.ssp-sr {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}

@keyframes ssp-flow { to { stroke-dashoffset: -12; } }
@keyframes ssp-spin { to { transform: rotate(360deg); } }
@keyframes ssp-pulse {
  0%, 100% { transform: scale(0.88) rotate(0deg); }
  50% { transform: scale(1.08) rotate(8deg); }
}
@keyframes ssp-twinkle {
  0%, 100% { transform: translate(-50%, -50%) scale(0.55) rotate(0deg); opacity: 0.45; }
  50% { transform: translate(-50%, -50%) scale(1) rotate(45deg); opacity: 1; }
}
@keyframes ssp-float {
  from { transform: translate3d(0, -4%, 0); }
  to { transform: translate3d(0, 4%, 0); }
}
@keyframes ssp-drift {
  from { transform: translate3d(-1.2%, 0, 0); }
  to { transform: translate3d(1.2%, -1%, 0); }
}
@keyframes ssp-sway {
  from { transform: skewX(-0.6deg); }
  to { transform: skewX(0.6deg); }
}
@keyframes ssp-nebula {
  from { transform: translate3d(-1.5%, 1%, 0); }
  to { transform: translate3d(1.5%, -1%, 0); }
}
@keyframes ssp-rain {
  from { background-position: 0 0; }
  to { background-position: -24px 256px; }
}
@keyframes ssp-grain {
  0% { transform: translate(0, 0); }
  25% { transform: translate(-6%, 4%); }
  50% { transform: translate(5%, -6%); }
  75% { transform: translate(-3%, -8%); }
  100% { transform: translate(7%, 3%); }
}
@keyframes ssp-letter {
  to { opacity: 1; filter: blur(0); transform: none; }
}
@keyframes ssp-act-in {
  from { opacity: 0; filter: blur(6px); }
  to { opacity: 1; filter: blur(0); }
}
@keyframes ssp-breathe { 50% { opacity: 0.3; } }

@media (prefers-reduced-motion: reduce) {
  .ssp-nebula-drift, .ssp-rays line, .ssp-core, .ssp-orbit, .ssp-planet img, .ssp-cloud-drift, .ssp-curtain-sway { animation: none; }
  .ssp-spark { animation: none; transform: translate(-50%, -50%); }
  .ssp-rain { display: none; }
  .ssp-grain { animation: none; }
  .ssp-hint { animation: none; }
  .ssp-rig, .ssp-planet, .ssp-cloud, .ssp-moon, .ssp-figure, .ssp-stage { transition-property: opacity; }
  .ssp-curtain { transition: none; }
  .ssp-draw { transition-duration: 0.01s; }
  .ssp-root:not([data-phase="load"]) .ssp-rig, .ssp-root:not([data-phase="load"]) .ssp-planet { transform: none; }
  .ssp-root[data-phase="lift"] .ssp-stage { transform: none; filter: none; }
  .ssp-letter { filter: none; transform: none; }
}
`

// ---- component ----------------------------------------------------------------

type Phase = "load" | "morph" | "reveal" | "lift" | "done"

const MORPH_MS = 3000
const HOLD_MS = 4200
const LIFT_MS = 1500
const REWIND_MS = 800

function Sparkle({ className, style }: { className: string; style: React.CSSProperties }) {
  return (
    <svg className={"ssp-spark " + className} viewBox="-1 -1 2 2" style={style} aria-hidden="true">
      <path d={SPARK} />
    </svg>
  )
}

export default function StardustStagePreloader({
  children,
  loop = false,
  progress,
  durationMs = 5200,
  word = "Nocturne",
  caption = "Act I · The sky takes the stage",
  acts = DEFAULT_ACTS,
  palette,
  density = 1,
  figure = true,
  rain = true,
  planets = true,
  counter = true,
  fontFamily = DISPLAY_STACK,
  height = "100svh",
  onComplete,
  waitForClick = false,
  className = "",
}: StardustStagePreloaderProps) {
  const [phase, setPhase] = React.useState<Phase>("load")
  const [pct, setPct] = React.useState(0)
  const [cycle, setCycle] = React.useState(0)
  const [veil, setVeil] = React.useState(false)
  const [tex, setTex] = React.useState<SspTextures | null>(null)
  const [box, setBox] = React.useState({ w: 1280, h: 800 })

  const rootRef = React.useRef<HTMLDivElement>(null)
  const canvasRef = React.useRef<HTMLCanvasElement>(null)
  const pointerRef = React.useRef<{ x: number; y: number; px: number; py: number; touch: boolean } | null>(null)
  const rushRef = React.useRef(false)
  const shownRef = React.useRef(0)
  const phaseRef = React.useRef<Phase>("load")
  const phaseAtRef = React.useRef(0)
  const progressRef = React.useRef(progress)
  progressRef.current = progress
  const onCompleteRef = React.useRef(onComplete)
  onCompleteRef.current = onComplete

  const colors = { ...DEFAULT_PALETTE, ...palette }
  const inkRef = React.useRef(colors.ink)
  inkRef.current = colors.ink
  const dense = Math.min(2, Math.max(0.3, density))

  const st = React.useMemo(() => sspStage(box.w, box.h), [box.w, box.h])
  const stRef = React.useRef(st)
  stRef.current = st
  const count = Math.round(Math.min(3600, Math.max(1300, (box.w * box.h) / 300)) * dense)
  const field = React.useMemo(() => buildField(st, count), [st, count])
  const fieldRef = React.useRef(field)
  fieldRef.current = field

  React.useEffect(() => {
    phaseRef.current = phase
    phaseAtRef.current = performance.now()
  }, [phase])

  // ---- paint the night once per look ---------------------------------------------
  // repainted when the stage changes size by a step, not on every pixel
  const q = Math.min(2, typeof devicePixelRatio === "number" ? devicePixelRatio : 1)
  const look = JSON.stringify([colors, dense, Math.round(st.W / 60), Math.round(st.H / 60), q])
  React.useEffect(() => {
    try {
      setTex(paintAll(colors, dense, sspSizes(stRef.current, q)))
    } catch {
      /* no canvas (tests, very old browsers): the dots and lines still play */
    }
  }, [look])

  // ---- size everything off the root ------------------------------------------------
  React.useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const measure = () => {
      const r = root.getBoundingClientRect()
      if (r.width > 0 && r.height > 0) setBox({ w: Math.round(r.width), h: Math.round(r.height) })
    }
    measure()
    if (typeof ResizeObserver === "undefined") return
    const ro = new ResizeObserver(measure)
    ro.observe(root)
    return () => ro.disconnect()
  }, [])

  // ---- load: drive the orbit from progress ------------------------------------------
  React.useEffect(() => {
    if (phase !== "load") return
    const root = rootRef.current
    let raf = 0
    let shown = 0
    let last = performance.now()
    const start = last
    let lastPct = -1
    rushRef.current = false

    const paint = (p: number) => {
      shownRef.current = p
      root?.style.setProperty("--ssp-p", p.toFixed(4))
      const next = Math.round(p * 100)
      if (next !== lastPct) {
        lastPct = next
        setPct(next)
      }
    }

    const tick = (now: number) => {
      const dt = Math.min(64, now - last)
      last = now
      const external = progressRef.current
      let target =
        external !== undefined ? clamp01(external / 100) : sspSimulated((now - start) / Math.max(400, durationMs))
      if (rushRef.current) target = 1
      // glide toward the target so stepped real progress still moves smoothly
      const rate = rushRef.current ? 0.09 : external !== undefined ? 0.1 : 1
      shown += (target - shown) * Math.min(1, rate * (dt / 16.7))
      if (target - shown < 0.002) shown = target
      paint(shown)
      if (shown >= 1) {
        setPhase("morph")
        return
      }
      raf = requestAnimationFrame(tick)
    }
    paint(0)
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [phase, cycle, durationMs])

  // ---- the dots: one loop draws every one, wherever it is in its flight ------------
  React.useEffect(() => {
    const cv = canvasRef.current
    const root = rootRef.current
    if (!cv || !root) return
    const g = cv.getContext("2d")
    if (!g) return
    const still = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches
    let raf = 0
    let last = performance.now()
    const t0 = last
    let m = 0
    let warp = 0
    let mx = 0
    let my = 0

    const tick = (now: number) => {
      const dt = Math.min(64, now - last)
      last = now
      const t = still ? 0 : (now - t0) / 1000
      const s = stRef.current
      const f = fieldRef.current
      const phase = phaseRef.current
      const p = shownRef.current
      const ptr = pointerRef.current

      // the camera leans toward the pointer, or wanders when there is none
      let tx = 0
      let ty = 0
      if (ptr && !ptr.touch) {
        tx = ptr.x
        ty = ptr.y
      } else if (!still) {
        tx = Math.sin(t * 0.37) * 0.4
        ty = Math.sin(t * 0.23 + 1.1) * 0.25
      }
      mx += (tx - mx) * 0.06
      my += (ty - my) * 0.06
      root.style.setProperty("--ssp-mx", mx.toFixed(4))
      root.style.setProperty("--ssp-my", my.toFixed(4))

      // how far the flight from cosmos to stage has come
      if (phase === "load") m = 0
      else if (phase === "morph") m = Math.max(m, clamp01((now - phaseAtRef.current) / (still ? 500 : MORPH_MS * 0.85)))
      else m = Math.min(1, m + dt / 700)
      const lift = phase === "lift" ? clamp01((now - phaseAtRef.current) / LIFT_MS) : 0
      warp += (dt / 1000) * (0.05 + 0.3 * p) * (still ? 0 : 1)

      const dpr = Math.min(2, typeof devicePixelRatio === "number" ? devicePixelRatio : 1)
      const cw = Math.round(s.w * dpr)
      const ch = Math.round(s.h * dpr)
      if (cv.width !== cw || cv.height !== ch) {
        cv.width = cw
        cv.height = ch
        cv.style.width = s.w + "px"
        cv.style.height = s.h + "px"
      }
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
      g.clearRect(0, 0, s.w, s.h)
      g.fillStyle = inkRef.current

      const R = s.u * 0.2
      const TAU = Math.PI * 2
      const haloA = Math.cos(t * 0.05)
      const haloB = Math.sin(t * 0.05)
      const reach = s.u * 0.12
      const px = ptr ? ptr.px : -1e5
      const py = ptr ? ptr.py : -1e5

      for (let i = 0; i < f.n; i++) {
        const role = f.role[i]
        const r1 = f.r1[i]
        const r2 = f.r2[i]
        const r3 = f.r3[i]
        const r4 = f.r4[i]

        // place in the cosmos
        let ax = 0
        let ay = 0
        let aa = 0
        if (m < 1) {
          if (role === 0) {
            const rad = s.u * 0.075 * Math.pow(r1, 1.5) * (1 + 0.06 * Math.sin(t * 1.6 + r3 * 9))
            const ang = r2 * TAU + t * 0.14 * (1 - r1)
            ax = s.cx + Math.cos(ang) * rad
            ay = s.cy + Math.sin(ang) * rad
            aa = (0.25 + 0.75 * (1 - r1)) * (0.35 + 0.65 * p)
          } else if (role === 1) {
            const ang = -Math.PI / 2 + r1 * TAU + Math.sin(t * 0.6 + r3 * 6) * 0.004
            const rad = R * (1 + (r2 - 0.5) * 0.045)
            ax = s.cx + Math.cos(ang) * rad
            ay = s.cy + Math.sin(ang) * rad
            aa = 0.09 + 0.91 * sspRingLit(r1, p)
          } else if (role === 2) {
            const ang = (Math.floor(r1 * 64) / 64) * TAU + (r2 - 0.5) * 0.02 + 0.05
            const trav = (r3 + warp * (0.6 + 0.8 * r4)) % 1
            const d = R * 1.18 + Math.pow(trav, 1.7) * s.u * 0.95
            ax = s.cx + Math.cos(ang) * d
            ay = s.cy + Math.sin(ang) * d
            aa = Math.sin(Math.PI * trav) * (0.1 + 0.7 * p) * (0.4 + 0.6 * r4)
          } else if (r3 < 0.5) {
            ax = r1 * s.w
            ay = r4 * s.h
            aa = 0.1 + 0.45 * r2 * r2
          } else {
            ax = f.bx[i]
            ay = f.by[i]
            aa = f.ba[i]
          }
        }

        // place on the stage; the halo turns slowly about the moon
        let bx = f.bx[i]
        let by = f.by[i]
        if (role === 1) {
          const dx = bx - s.moonX
          const dy = by - s.moonY
          const dir = r3 < 0.55 ? 1 : -1
          bx = s.moonX + dx * haloA - dy * haloB * dir
          by = s.moonY + dx * haloB * dir + dy * haloA
        }
        const ba = f.ba[i]

        let x = ax
        let y = ay
        let a = aa
        if (m >= 1) {
          x = bx
          y = by
          a = ba
        } else if (m > 0) {
          const e = sspEase(sspMorph(m, f.delay[i]))
          if (still) {
            x = e < 0.5 ? ax : bx
            y = e < 0.5 ? ay : by
            a = e < 0.5 ? aa * (1 - e * 2) : ba * (e * 2 - 1)
          } else {
            // fly along an arc, not a straight line
            const arc = Math.sin(Math.PI * e) * f.twist[i]
            const dx = bx - ax
            const dy = by - ay
            x = ax + dx * e - dy * arc
            y = ay + dy * e + dx * arc
            a = aa + (ba - aa) * e + Math.sin(Math.PI * e) * 0.35
          }
        }

        if (!still) a *= 0.8 + 0.2 * Math.sin(t * (1.4 + r3 * 3) + r4 * 40)
        if (lift > 0) {
          const k = 1 + lift * lift * 2.4
          x = s.moonX + (x - s.moonX) * k
          y = s.moonY + (y - s.moonY) * k
          a *= 1 - lift
        }

        // the pointer parts the dust, and it settles back behind it
        let qx = 0
        let qy = 0
        const ddx = x - px
        const ddy = y - py
        const d2 = ddx * ddx + ddy * ddy
        if (d2 < reach * reach && d2 > 0.01) {
          const d = Math.sqrt(d2)
          const push = 1 - d / reach
          const pw = push * push * reach * 0.55
          qx = (ddx / d) * pw
          qy = (ddy / d) * pw
          a += push * 0.5
        }
        f.ox[i] += (qx - f.ox[i]) * 0.12
        f.oy[i] += (qy - f.oy[i]) * 0.12
        x += f.ox[i] - mx * f.depth[i]
        y += f.oy[i] - my * f.depth[i]

        if (a < 0.02) continue
        g.globalAlpha = a > 1 ? 1 : a
        const sz = f.size[i]
        g.fillRect(x - sz * 0.5, y - sz * 0.5, sz, sz)
      }
      g.globalAlpha = 1
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  // ---- holds between phases ---------------------------------------------------------
  React.useEffect(() => {
    if (phase === "morph") {
      const t = setTimeout(() => setPhase("reveal"), MORPH_MS)
      return () => clearTimeout(t)
    }
    if (phase === "reveal") {
      if (waitForClick && !loop) return
      const t = setTimeout(() => {
        if (loop) setVeil(true)
        else setPhase("lift")
      }, HOLD_MS)
      return () => clearTimeout(t)
    }
    if (phase === "lift") {
      const t = setTimeout(() => {
        setPhase("done")
        onCompleteRef.current?.()
      }, LIFT_MS)
      return () => clearTimeout(t)
    }
  }, [phase, loop, waitForClick])

  // the veil comes down, the cosmos resets beneath it, the veil goes up
  React.useEffect(() => {
    if (!veil) return
    const t = setTimeout(() => {
      setPct(0)
      setPhase("load")
      setCycle((c) => c + 1)
      setVeil(false)
    }, REWIND_MS)
    return () => clearTimeout(t)
  }, [veil])

  const onActivate = () => {
    if (veil) return
    if (phase === "load") rushRef.current = true
    else if (phase === "morph") setPhase("reveal")
    else if (phase === "reveal") {
      if (loop) setVeil(true)
      else setPhase("lift")
    }
  }

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const root = rootRef.current
    if (!root) return
    const r = root.getBoundingClientRect()
    pointerRef.current = {
      x: ((e.clientX - r.left) / r.width) * 2 - 1,
      y: ((e.clientY - r.top) / r.height) * 2 - 1,
      px: e.clientX - r.left,
      py: e.clientY - r.top,
      touch: e.pointerType === "touch",
    }
  }
  const onPointerLeave = () => {
    pointerRef.current = null
  }

  const loading = phase === "load"
  const act = acts.length ? acts[sspAct(pct / 100, acts.length)] : ""
  const hint = loop ? "Click to replay" : "Click to enter"
  const url = (s: string | undefined) => (s ? 'url("' + s + '")' : "none")

  // ---- the stage, in its own box ------------------------------------------------------
  const lx = (x: number) => x - st.x0
  const ly = (y: number) => y - st.y0
  const L = lx(st.left)
  const Rt = lx(st.right)
  const S = ly(st.spring)
  const C = ly(st.crown)
  const F = ly(st.floor)
  const rx = (Rt - L) / 2
  const ry = S - C
  const ins = st.W * 0.028
  const archOuter = "M" + L + " " + F + "V" + S + "A" + rx + " " + ry + " 0 0 1 " + Rt + " " + S + "V" + F
  const archInner =
    "M" + (L + ins) + " " + F + "V" + S + "A" + (rx - ins) + " " + (ry - ins) + " 0 0 1 " + (Rt - ins) + " " + S + "V" + F
  const col = st.W * 0.022
  // scallops along the underside of the inner arch
  const scallops = (() => {
    const k = 16
    const rr = rx - ins * 2.1
    const rv = ry - ins * 2.1
    const cx = L + rx
    let d = ""
    for (let j = 0; j <= k; j++) {
      const phi = Math.PI - (j / k) * Math.PI
      const x = cx + rr * Math.cos(phi)
      const y = S - rv * Math.sin(phi)
      d += (j === 0 ? "M" : "A" + (rr * 0.11).toFixed(1) + " " + (rr * 0.11).toFixed(1) + " 0 0 0 ") + x.toFixed(1) + " " + y.toFixed(1)
    }
    return d
  })()
  const figH = st.H * FIGURE_H
  const figW = figH / 2
  const curtainTop = S - st.H * 0.02
  const curtainW = st.W * CURTAIN_W
  const curtainH = F - curtainTop

  const cloud = (k: number) => {
    const [x, rise, w, h, wait, drift] = CLOUDS[k]
    return (
      <div
        className="ssp-cloud"
        style={
          {
            left: st.W * x,
            top: F - st.H * rise,
            width: st.W * w,
            height: st.H * h,
            "--bg": url(tex?.clouds[k]),
            "--w": wait + "s",
          } as React.CSSProperties
        }
      >
        <div className="ssp-cloud-drift" style={{ "--f": drift + "s" } as React.CSSProperties} />
      </div>
    )
  }

  const scene = (mirror: boolean) => (
    <>
      <div className="ssp-par ssp-par-far">
        <div
          className="ssp-moonglow"
          style={{ left: lx(st.moonX) - st.moonR * 4, top: ly(st.moonY) - st.moonR * 4, width: st.moonR * 8, height: st.moonR * 8 }}
        />
        <div
          className="ssp-moon"
          style={{
            left: lx(st.moonX) - st.moonR,
            top: ly(st.moonY) - st.moonR,
            width: st.moonR * 2,
            height: st.moonR * 2,
            backgroundImage: url(tex?.moon),
          }}
        />
        {cloud(2)}
      </div>
      <div className="ssp-par ssp-par-mid">
        {cloud(0)}
        {cloud(1)}
        {cloud(3)}
      </div>
      <div className="ssp-par ssp-par-near">
        <svg className="ssp-arch" width={st.W} height={st.H} viewBox={"0 0 " + st.W + " " + st.H} aria-hidden="true">
          <path className="ssp-draw" pathLength={1} d={archOuter} strokeWidth={2.2} style={{ "--w": "0.4s" } as React.CSSProperties} />
          <path className="ssp-draw" pathLength={1} d={archInner} strokeWidth={1} opacity={0.7} style={{ "--w": "0.7s" } as React.CSSProperties} />
          <path className="ssp-orn" d={scallops} strokeWidth={1} strokeDasharray="1.5 3" opacity={0.65} />
          {[L - col, Rt + col].map((x, j) => (
            <path
              key={j}
              className="ssp-draw"
              pathLength={1}
              d={"M" + x + " " + F + "V" + (S + st.H * 0.02)}
              strokeWidth={1}
              opacity={0.55}
              style={{ "--w": "0.9s" } as React.CSSProperties}
            />
          ))}
          {[L, Rt].map((x, j) => (
            <g key={"cap" + j} className="ssp-orn" strokeWidth={1.2}>
              <path d={"M" + (x - col * 1.6) + " " + (S + st.H * 0.02) + "H" + (x + col * 1.6)} />
              <path d={"M" + (x - col * 1.3) + " " + (S + st.H * 0.035) + "H" + (x + col * 1.3)} opacity={0.6} />
              <path d={"M" + (x - col * 1.7) + " " + (F - 1) + "H" + (x + col * 1.7)} />
              <path d={"M" + (x - col * 0.5) + " " + (S + st.H * 0.05) + "V" + (F - st.H * 0.01)} strokeDasharray="1 4" opacity={0.5} />
              <path d={"M" + (x + col * 0.5) + " " + (S + st.H * 0.05) + "V" + (F - st.H * 0.01)} strokeDasharray="1 4" opacity={0.5} />
            </g>
          ))}
          <path className="ssp-orn" d={"M" + (L - col * 2) + " " + F + "H" + (Rt + col * 2)} strokeWidth={1} opacity={0.5} />
        </svg>
        <div
          className="ssp-curtain"
          style={{ left: L + col * 0.4, top: curtainTop, width: curtainW, height: curtainH, "--bg": url(tex?.curtain) } as React.CSSProperties}
        >
          <div className="ssp-curtain-sway" />
        </div>
        <div
          className="ssp-curtain ssp-curtain-r"
          style={{ left: Rt - col * 0.4 - curtainW, top: curtainTop, width: curtainW, height: curtainH, "--bg": url(tex?.curtain) } as React.CSSProperties}
        >
          <div className="ssp-curtain-sway" style={{ animationDelay: "-3s" }} />
        </div>
        <div className="ssp-pool" style={{ left: st.W / 2 - st.W * 0.2, top: F - st.H * 0.04, width: st.W * 0.4, height: st.H * 0.08 }} />
        {figure ? (
          <div
            className="ssp-figure"
            style={{ left: st.W / 2 - figW / 2, top: F - figH + 1, width: figW, height: figH, backgroundImage: url(tex?.figure) }}
          />
        ) : null}
        {!mirror
          ? STAGE_SPARKS.map(([x, y, size, delay], i) => (
              <Sparkle
                key={i}
                className="ssp-skyspark ssp-stagespark"
                style={{ left: x + "%", top: y + "%", width: st.u * size, height: st.u * size, animationDelay: delay + "s" }}
              />
            ))
          : null}
      </div>
    </>
  )

  return (
    <div
      ref={rootRef}
      className={"ssp-root " + className}
      data-phase={phase}
      data-rain={rain}
      style={
        {
          height,
          "--ssp-u": st.u + "px",
          "--ssp-mx": 0,
          "--ssp-my": 0,
          "--ssp-p": 0,
          "--ssp-dx": st.moonX - st.cx + "px",
          "--ssp-dy": st.moonY - st.cy + "px",
          "--ssp-stage": colors.stage,
          "--ssp-ink": colors.ink,
          "--ssp-dim": colors.dim,
          "--ssp-display": fontFamily,
          "--ssp-mono": MONO_STACK,
          "--ssp-stars": url(tex?.stars),
          "--ssp-nebula": url(tex?.nebula),
          "--ssp-rain": url(tex?.rain),
          "--ssp-grain": url(tex?.grain),
        } as React.CSSProperties
      }
      onPointerMove={onPointerMove}
      onPointerDown={onPointerMove}
      onPointerLeave={onPointerLeave}
    >
      <style>{SSP_CSS}</style>

      {!loop && children ? (
        <div className="ssp-dest" data-active={phase === "done"} aria-hidden={phase !== "done"}>
          {children}
        </div>
      ) : null}

      {phase !== "done" ? (
        <div
          className="ssp-gate"
          role="progressbar"
          aria-label={word + " is loading"}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          aria-valuetext={loading ? pct + "%" : "Loaded. Press Enter to continue."}
          tabIndex={0}
          onClick={onActivate}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault()
              onActivate()
            }
          }}
        >
          <div className="ssp-layer ssp-sky" />
          <div className="ssp-layer ssp-nebula">
            <div className="ssp-nebula-drift" />
          </div>
          {SKY_SPARKS.map(([x, y, size, delay], i) => (
            <Sparkle
              key={i}
              className="ssp-skyspark"
              style={{ left: x + "%", top: y + "%", width: st.u * size, height: st.u * size, animationDelay: delay + "s" }}
            />
          ))}

          <div key={cycle} className="ssp-layer" aria-hidden="true">
            {planets && tex
              ? PLANETS.map(([x, y, size, k, fl], i) => (
                  <div
                    key={i}
                    className="ssp-planet-par"
                    style={{ left: st.cx + x * st.u, top: st.cy + y * st.u, "--d": 10 + size * 60 } as React.CSSProperties}
                  >
                    <div
                      className="ssp-planet"
                      style={
                        {
                          left: (-st.u * size * (k === 3 ? 1.9 : 1)) / 2,
                          top: (-st.u * size * (k === 3 ? 1.9 : 1)) / 2,
                          width: st.u * size * (k === 3 ? 1.9 : 1),
                          height: st.u * size * (k === 3 ? 1.9 : 1),
                          "--vx": x,
                          "--vy": y,
                          "--f": fl + "s",
                        } as React.CSSProperties
                      }
                    >
                      <img src={tex.planets[k]} alt="" draggable={false} />
                    </div>
                  </div>
                ))
              : null}

            <div className="ssp-stage" style={{ left: st.x0, top: st.y0, width: st.W, height: st.H }}>
              {scene(false)}
              <div className="ssp-mirror" style={{ top: F, width: st.W, height: st.H - F + st.H * 0.16 }}>
                <div
                  className="ssp-mirror-flip"
                  style={{ top: -F, width: st.W, height: st.H, transformOrigin: "50% " + F + "px", transform: "scaleY(-1)" }}
                >
                  {scene(true)}
                </div>
              </div>
            </div>

            <div className="ssp-rig" style={{ left: st.cx, top: st.cy }}>
              <div className="ssp-glow" />
              <svg className="ssp-rays" viewBox="-100 -100 200 200" aria-hidden="true">
                {RAYS.map(([ang, from, to, dash, dur], i) => (
                  <line
                    key={i}
                    x1={Math.cos(ang) * from}
                    y1={Math.sin(ang) * from}
                    x2={Math.cos(ang) * to}
                    y2={Math.sin(ang) * to}
                    strokeDasharray={dash + " " + (12 - dash)}
                    style={{ animationDuration: dur + "s" }}
                  />
                ))}
              </svg>
              <span className="ssp-flare" style={{ "--a": "-27deg" } as React.CSSProperties} />
              <span className="ssp-flare ssp-flare-b" style={{ "--a": "58deg" } as React.CSSProperties} />
              <div className="ssp-orbit">
                <i className="ssp-moonlet" style={{ left: "50%", top: "0%" }} />
                <i className="ssp-moonlet" style={{ left: "93.3%", top: "75%" }} />
                <i className="ssp-moonlet" style={{ left: "6.7%", top: "75%", transform: "scale(0.6)" }} />
              </div>
              <div className="ssp-core">
                <svg viewBox="-1 -1 2 2" aria-hidden="true">
                  <path d={SPARK} />
                </svg>
              </div>
            </div>
          </div>

          <canvas ref={canvasRef} className="ssp-dots" aria-hidden="true" />

          {counter ? (
            <div className="ssp-readout" style={{ top: st.cy + st.u * 0.27 }} aria-hidden="true">
              <p className="ssp-count">{String(pct).padStart(3, "0")}</p>
              {act ? (
                <p key={act} className="ssp-act">
                  {act}
                </p>
              ) : null}
            </div>
          ) : null}

          <div className="ssp-title" style={{ top: st.floor + st.H * 0.045 }} aria-hidden="true">
            <p className="ssp-word">
              {Array.from(word).map((ch, i) => (
                <span key={i + ch} className="ssp-letter" style={{ animationDelay: 0.1 + i * 0.09 + "s" }}>
                  {ch === " " ? " " : ch}
                </span>
              ))}
            </p>
            {caption ? <p className="ssp-caption">{caption}</p> : null}
            <p className="ssp-hint">{hint}</p>
          </div>

          <div className="ssp-layer ssp-rain" />
          <div className="ssp-layer ssp-vignette" />
          <div className="ssp-layer ssp-grain" />
          <div className="ssp-bar ssp-bar-top" />
          <div className="ssp-bar ssp-bar-bot" />
          <div className="ssp-frame" />
          <div className="ssp-veil" data-on={veil} />
          <span className="ssp-sr" aria-live="polite">
            {loading ? act : word + " — " + caption}
          </span>
        </div>
      ) : null}
    </div>
  )
}
