import { useRef, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ApiError, api } from "../lib/api";
import { useSession } from "../lib/session";
import { Logo, Spinner, TextField } from "../components/ui";

type Errors = Partial<Record<"email" | "password" | "full_name" | "form", string>>;

export function AuthPage({ mode }: { mode: "login" | "signup" }) {
  const isSignup = mode === "signup";
  const nav = useNavigate();
  const setSession = useSession((s) => s.setSession);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const pwRef = useRef<HTMLInputElement>(null);

  function validate(): Errors {
    const e: Errors = {};
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) e.email = "Write an email address with an @ and a domain.";
    if (isSignup && password.length < 10) e.password = "Use at least 10 characters.";
    if (!isSignup && !password) e.password = "Write your password.";
    return e;
  }

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    const v = validate();
    setErrors(v);
    if (v.email) return emailRef.current?.focus();
    if (v.password) return pwRef.current?.focus();
    setBusy(true);
    try {
      const s = isSignup
        ? await api.signup(email.trim(), password, fullName.trim() || undefined)
        : await api.login(email.trim(), password);
      setSession(s.user, s.brand);
      nav(s.brand?.onboarded ? "/" : "/onboarding", { replace: true });
    } catch (e) {
      const err = e as ApiError;
      if (err.field === "email" || err.field === "password") setErrors({ [err.field]: err.message });
      else setErrors({ form: err.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-full grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="flex flex-col px-6 sm:px-12 py-8">
        <Logo href="/" />
        <main className="flex-1 flex items-center">
          <div className="w-full max-w-[400px] mx-auto py-12">
            <h1 className="text-[32px] leading-tight font-medium tracking-display">
              {isSignup ? "Create your Branchwise account" : "Log in to Branchwise"}
            </h1>
            <p className="mt-3 text-fg-secondary text-base leading-relaxed">
              {isSignup
                ? "Set up your brand in about three minutes and get a ranked list of Sydney sites."
                : "Pick up your ranked sites and shortlist where you left them."}
            </p>

            <form className="mt-8 space-y-5" onSubmit={submit} noValidate>
              {isSignup && (
                <TextField
                  label="Your name"
                  autoComplete="name"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  maxLength={120}
                  hint="Optional"
                />
              )}
              <TextField
                ref={emailRef}
                label="Work email"
                type="email"
                autoComplete="email"
                inputMode="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                error={errors.email}
                maxLength={254}
                required
              />
              <TextField
                ref={pwRef}
                label="Password"
                type="password"
                autoComplete={isSignup ? "new-password" : "current-password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                error={errors.password}
                hint={isSignup ? "At least 10 characters. A short sentence works well." : undefined}
                maxLength={200}
                required
              />

              <button type="submit" className="btn-primary w-full h-12" disabled={busy}>
                {busy && <Spinner />}
                {isSignup ? "Create account" : "Log in"}
              </button>
              <p role="status" className={errors.form ? "text-sm text-danger" : "sr-only"}>
                {errors.form ?? (busy ? "Sending" : "")}
              </p>
            </form>

            <p className="mt-8 text-sm text-fg-tertiary">
              {isSignup ? (
                <>Already have an account? <Link className="link" to="/login">Log in</Link></>
              ) : (
                <>New to Branchwise? <Link className="link" to="/signup">Create an account</Link></>
              )}
            </p>
          </div>
        </main>
        <p className="text-[13px] text-fg-tertiary">
          Your brand profile and stores are private to your account. Delete them any time from Settings.
        </p>
      </div>

      <aside className="hidden lg:flex flex-col justify-end bg-[#0a0a0a] text-[#f8f8f8] p-12 relative overflow-hidden" aria-hidden="true">
        <HexField />
        <div className="relative max-w-md">
          <p className="text-[28px] leading-snug font-medium tracking-display">
            Every 300 m zone of Greater Sydney, scored for your brand.
          </p>
          <ul className="mt-6 space-y-2 text-[#c9c9c9] text-base">
            <li>Five signals from Foursquare's open places data</li>
            <li>Weighted by what you say matters to your stores</li>
            <li>Ranked, spaced apart, with the reasons beside each site</li>
          </ul>
        </div>
      </aside>
    </div>
  );
}

/** Decorative hex grid in the score colours. */
function HexField() {
  const cols = 9;
  const rows = 8;
  const palette = ["#2f8a52", "#2f8a52", "#2f8a52", "#c98317", "#c2473b", "#1c1c1c", "#1c1c1c"];
  let seed = 7;
  const rand = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
  const cells = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = c * 66 + (r % 2 ? 33 : 0);
      const y = r * 57;
      const fill = palette[Math.floor(rand() * palette.length)];
      cells.push(
        <polygon
          key={`${r}-${c}`}
          points="33,0 66,19 66,57 33,76 0,57 0,19"
          transform={`translate(${x} ${y}) scale(0.94)`}
          fill={fill}
          opacity={fill === "#1c1c1c" ? 1 : 0.55}
        />
      );
    }
  }
  return (
    <svg className="absolute -top-6 -right-10 w-[640px] opacity-90" viewBox="0 0 620 480">
      {cells}
    </svg>
  );
}
