import { useEffect, useRef } from "react";

interface Props {
  /** Ring count; more rings fill more of the box. */
  rings?: number;
  className?: string;
}

// Concentric ellipses drawn in glyphs that drift slowly around the centre,
// thinning toward the middle so text placed there stays readable.
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

    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      if (now - last < 50) return; // ~20fps is plenty for drifting text
      last = now;
      const t = still ? 0 : now / 1000;
      const css = getComputedStyle(cv);
      g.clearRect(0, 0, w, h);
      g.fillStyle = css.color;
      g.font = `12px ${css.fontFamily}`;
      g.textAlign = "center";
      g.textBaseline = "middle";
      const cx = w / 2;
      const cy = h / 2;
      for (let ring = 0; ring < rings; ring++) {
        const k = (ring + 1) / rings;
        const rx = (w / 2) * (0.32 + 0.72 * k);
        const ry = (h / 2) * (0.3 + 0.66 * k);
        const glyph = GLYPHS[(rings - 1 - ring) % GLYPHS.length];
        const steps = Math.floor((Math.PI * (rx + ry)) / 15);
        const spin = t * 0.015 * (ring % 2 ? 1 : -1);
        for (let i = 0; i < steps; i++) {
          if (gap(ring, i) < 0.42) continue;
          const a = (i / steps) * Math.PI * 2 + spin;
          const x = cx + Math.cos(a) * rx;
          const y = cy + Math.sin(a) * ry;
          if (x < -10 || x > w + 10 || y < -10 || y > h + 10) continue;
          const twinkle = 0.75 + 0.25 * Math.sin(t * 1.3 + i * 0.7 + ring);
          g.globalAlpha = (0.12 + 0.5 * k) * twinkle;
          g.fillText(glyph, x, y);
        }
      }
      g.globalAlpha = 1;
    };

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(cv);
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [rings]);

  return <canvas ref={ref} className={`ascii ${className}`} aria-hidden="true" />;
}
