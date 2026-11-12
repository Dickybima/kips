import { useState, type ReactNode } from "react";
import { Copy } from "./Icons";

export function Label({ n, children }: { n: string; children: ReactNode }) {
  return (
    <p className="label">
      <span className="accent">[ {n} ]</span> {children}
    </p>
  );
}

export function PageHead({ n, label, title, children }: { n: string; label: string; title: ReactNode; children?: ReactNode }) {
  return (
    <header className="page-head">
      <Label n={n}>{label}</Label>
      <h1>{title}</h1>
      {children && <p className="lede">{children}</p>}
    </header>
  );
}

/** A bordered box with "+" marks on its corners. */
export function Corners({ children, className = "", accent = false }: { children: ReactNode; className?: string; accent?: boolean }) {
  return (
    <div className={`corners ${accent ? "corners-accent" : ""} ${className}`}>
      <i className="c tl" />
      <i className="c tr" />
      <i className="c bl" />
      <i className="c br" />
      {children}
    </div>
  );
}

/** A label, a dotted leader, and a value. */
export function Leader({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="leader">
      <span className="leader-k">{k}</span>
      <span className="leader-dots" />
      <span className="leader-v">{children}</span>
    </div>
  );
}

export function CopyButton({ value, label = "Copy", className = "chip" }: { value: string; label?: string; className?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className={className}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        navigator.clipboard?.writeText(value).then(
          () => {
            setDone(true);
            setTimeout(() => setDone(false), 1400);
          },
          () => {},
        );
      }}
    >
      <Copy width={14} height={14} />
      {done ? "Copied" : label}
    </button>
  );
}
