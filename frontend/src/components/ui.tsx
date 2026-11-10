import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from "react";
import { useSession } from "../lib/session";

/** The mark: a navy hexagon (a map zone) with a pin cut into it. */
export function LogoMark({ size = 24, invert = false }: { size?: number; invert?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <path d="M16 2.5 28 9.5v13L16 29.5 4 22.5v-13z" fill={invert ? "#F4FCFB" : "#243C4C"} />
      <path d="M16 9.2a5.3 5.3 0 0 0-5.3 5.3c0 4 5.3 9.3 5.3 9.3s5.3-5.3 5.3-9.3A5.3 5.3 0 0 0 16 9.2z" fill={invert ? "#243C4C" : "#F4FCFB"} />
      <circle cx="16" cy="14.5" r="2.2" fill="#5289AD" />
    </svg>
  );
}

export function Logo({ size = 20, href, invert = false }: { size?: number; href?: string; invert?: boolean }) {
  const inner = (
    <span
      className={`inline-flex items-center gap-2 font-display ${invert ? "text-brand-mint" : "text-fg-primary"}`}
      style={{ fontSize: size }}
    >
      <LogoMark size={Math.round(size * 1.3)} invert={invert} />
      Branchwise
    </span>
  );
  return href ? (
    <a href={href} className="rounded-sm" aria-label="Branchwise home">
      {inner}
    </a>
  ) : (
    inner
  );
}

type FieldProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  error?: string | null;
  hint?: ReactNode;
};

export const TextField = forwardRef<HTMLInputElement, FieldProps>(function TextField(
  { label, error, hint, id, className, ...rest },
  ref
) {
  const auto = useId();
  const fid = id ?? auto;
  const errId = `${fid}-err`;
  const hintId = `${fid}-hint`;
  return (
    <div className={className}>
      <label htmlFor={fid} className="field-label">{label}</label>
      <input
        ref={ref}
        id={fid}
        className="field-input"
        aria-invalid={error ? "true" : undefined}
        aria-describedby={error ? errId : hint ? hintId : undefined}
        {...rest}
      />
      {error ? (
        <p id={errId} className="field-error">{error}</p>
      ) : hint ? (
        <p id={hintId} className="field-hint">{hint}</p>
      ) : null}
    </div>
  );
});

export function Spinner({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-block w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin ${className}`}
      aria-hidden="true"
    />
  );
}

/** Says plainly when the app is running on generated demo data. */
export function DataBadge() {
  const health = useSession((s) => s.health);
  const src = health?.dataset?.source;
  if (!src || src === "foursquare") return null;
  return (
    <span
      className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full bg-[#fff4e0] text-[#7a4b00] text-[13px] font-medium"
      title="Scores are computed on generated demo places. Load Foursquare data for real results."
    >
      <span className="w-1.5 h-1.5 rounded-full bg-[#c98317]" aria-hidden="true" />
      Demo data
    </span>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  label: string;
}) {
  return (
    <div role="tablist" aria-label={label} className="flex p-1 rounded-sm bg-bg-elevated">
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={`flex-1 h-8 px-3 rounded-[6px] text-sm font-medium transition-colors ${
            value === o.value ? "bg-white text-fg-primary shadow-sm" : "text-fg-tertiary hover:text-fg-primary"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
