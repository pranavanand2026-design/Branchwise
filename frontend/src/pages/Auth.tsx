import { useRef, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ApiError, api } from "../lib/api";
import { useSession } from "../lib/session";
import { Logo, Spinner, TextField } from "../components/ui";
import { HexMapAnimation } from "../components/HexMapAnimation";

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
            <h1 className="text-[34px] leading-tight">
              {isSignup ? "Create your Branchwise account" : "Log in to Branchwise"}
            </h1>
            <p className="mt-3 text-fg-secondary text-base leading-relaxed">
              {isSignup
                ? "Answer four quick questions about your brand and see where it fits best in Sydney."
                : "Pick up your shortlist where you left it."}
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

      <aside className="hidden lg:block relative overflow-hidden bg-brand-navy" aria-hidden="true">
        <div className="absolute inset-0"><HexMapAnimation busy={busy} /></div>
        <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-brand-navy via-brand-navy/80 to-transparent" />
        <div className="absolute left-12 right-12 bottom-12 max-w-md text-brand-mint">
          <p className="font-display text-[32px] leading-[1.15]">
            {busy ? "Sizing up Sydney for you…" : "Know where your next store belongs before you sign anything."}
          </p>
          <p className="mt-4 text-base text-[#C9D6D8]">
            Tell us about your brand. We look at what's around every corner of Sydney and show you the best fits.
          </p>
        </div>
      </aside>
    </div>
  );
}
