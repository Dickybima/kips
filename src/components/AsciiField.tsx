import { useEffect, useRef } from "react";

interface Props {
  /** Ring count; more rings fill more of the box. */
  rings?: number;
  className?: string;
}

// Concentric ellipses drawn in glyphs. Each ring breathes and drifts, the
// field leans toward the pointer, glyphs near it light up, and the inner rings
// glow in the accent colour. Thins toward the middle so text stays readable.
const GLYPHS = ["@", "%", "#", "*", "·"];

export function AsciiField({ rings = 5, className = "" }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const g = cv.getContext("2d");
    if (!g) return;
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let w = 0;
    let h = 0;
    let raf = 0;
    let last = 0;
    let visible = true;
    // Pointer position in -1..1 around the centre, eased every frame.
    const target = { x: 0, y: 0, on: 0 };
    const eased = { x: 0, y: 0, on: 0 };

    const resize = () => {
      const r = cv.getBoundingClientRect();
      const dpr = Math.min(2, devicePixelRatio || 1);
      w = r.width;
      h = r.height;
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    // Deterministic gaps so the rings look hand-set rather than noisy.
    const gap = (ring: number, i: number) => {
      const x = Math.sin(ring * 91.7 + i * 12.9898) * 43758.5453;
      return x - Math.floor(x);
    };

    const onMove = (e: PointerEvent) => {
      const r = cv.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width) * 2 - 1;
      const y = ((e.clientY - r.top) / r.height) * 2 - 1;
      const inside = Math.abs(x) <= 1.1 && Math.abs(y) <= 1.1;
      target.x = inside ? x : 0;
      target.y = inside ? y : 0;
      target.on = inside && e.pointerType !== "touch" ? 1 : 0;
    };

    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      if (!visible || now - last < 33) return; // ~30fps is plenty for drifting text
      last = now;
      const t = still ? 0 : now / 1000;
      const css = getComputedStyle(cv);
      const fg = css.color;
      const accent = css.getPropertyValue("--accent").trim() || fg;

      const k = still ? 1 : 0.06;
      eased.x += (target.x - eased.x) * k;
      eased.y += (target.y - eased.y) * k;
      eased.on += (target.on - eased.on) * k;

      g.clearRect(0, 0, w, h);
      g.textAlign = "center";
      g.textBaseline = "middle";
      // The whole field leans a little toward the pointer, and wanders when idle.
      const cx = w / 2 + eased.x * w * 0.035 + Math.sin(t * 0.21) * w * 0.008;
      const cy = h / 2 + eased.y * h * 0.035 + Math.cos(t * 0.17) * h * 0.01;
      const px = w / 2 + eased.x * (w / 2);
      const py = h / 2 + eased.y * (h / 2);
      const reach = Math.min(w, h) * 0.22;

      for (let ring = 0; ring < rings; ring++) {
        const k01 = (ring + 1) / rings;
        const breathe = 1 + 0.018 * Math.sin(t * 0.6 + ring * 0.9);
        const rx = (w / 2) * (0.32 + 0.72 * k01) * breathe;
        const ry = (h / 2) * (0.3 + 0.66 * k01) * breathe;
        const glyph = GLYPHS[(rings - 1 - ring) % GLYPHS.length];
        const inner = ring < 2;
        const steps = Math.floor((Math.PI * (rx + ry)) / 15);
        const spin = t * (0.02 + ring * 0.004) * (ring % 2 ? 1 : -1);
        const size = 11 + k01 * 3;
        g.font = `${size.toFixed(1)}px ${css.fontFamily}`;
        for (let i = 0; i < steps; i++) {
          if (gap(ring, i) < 0.42) continue;
          const a = (i / steps) * Math.PI * 2 + spin;
          const x = cx + Math.cos(a) * rx;
          const y = cy + Math.sin(a) * ry;
          if (x < -12 || x > w + 12 || y < -12 || y > h + 12) continue;

          let alpha = (0.12 + 0.5 * k01) * (0.7 + 0.3 * Math.sin(t * 1.3 + i * 0.7 + ring));
          let lit = 0;
          if (eased.on > 0.01) {
            // Glyphs near the pointer light up; the rings keep their shape.
            const d = Math.hypot(x - px, y - py);
            if (d < reach) {
              lit = (1 - d / reach) * eased.on;
              alpha += lit * 0.6;
            }
          }
          g.fillStyle = inner || lit > 0.25 ? accent : fg;
          g.globalAlpha = Math.min(1, inner ? alpha * 0.9 + 0.08 : alpha);
          g.fillText(glyph, x, y);
        }
      }
      g.globalAlpha = 1;
    };

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(cv);
    const io = new IntersectionObserver(([e]) => (visible = e?.isIntersecting ?? true));
    io.observe(cv);
    window.addEventListener("pointermove", onMove, { passive: true });
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      window.removeEventListener("pointermove", onMove);
    };
  }, [rings]);

  return <canvas ref={ref} className={`ascii ${className}`} aria-hidden="true" />;
}
