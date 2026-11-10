import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from "react";
import { useSession } from "../lib/session";

export function Logo({ size = 20, href }: { size?: number; href?: string }) {
  const inner = (
    <span className="inline-flex items-center font-medium tracking-display text-fg-primary" style={{ fontSize: size }}>
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
