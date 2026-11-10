// The account button in the app's top bar: your initial, opening a small menu.
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { LogOut, Settings as SettingsIcon, Sparkles } from "lucide-react";
import { useSession } from "../lib/session";

export function ProfileMenu({ onTour, onLogout }: { onTour: () => void; onLogout: () => void }) {
  const user = useSession((s) => s.user);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const name = user?.full_name || user?.email || "";
  const initial = name.trim().charAt(0).toUpperCase() || "?";

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Your account"
        data-tour="settings"
        className="w-9 h-9 rounded-full bg-brand-navy text-brand-mint grid place-items-center font-display text-[15px] hover:ring-4 hover:ring-accent-soft transition-shadow"
      >
        {initial}
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-11 z-50 w-64 bg-white rounded-md border border-bg-border shadow-pop py-2">
          <div className="px-4 pt-1 pb-3 border-b border-bg-border">
            {user?.full_name && <p className="text-[15px] font-medium truncate">{user.full_name}</p>}
            <p className="text-sm text-fg-tertiary truncate">{user?.email}</p>
          </div>
          <Link role="menuitem" to="/settings" className="flex items-center gap-3 px-4 h-11 text-[15px] hover:bg-bg-base" onClick={() => setOpen(false)}>
            <SettingsIcon size={17} aria-hidden="true" /> Settings
          </Link>
          <button role="menuitem" className="w-full flex items-center gap-3 px-4 h-11 text-[15px] hover:bg-bg-base text-left" onClick={() => { setOpen(false); onTour(); }}>
            <Sparkles size={17} aria-hidden="true" /> Take the tour
          </button>
          <div className="my-1 border-t border-bg-border" />
          <button role="menuitem" className="w-full flex items-center gap-3 px-4 h-11 text-[15px] hover:bg-bg-base text-left" onClick={() => { setOpen(false); onLogout(); }}>
            <LogOut size={17} aria-hidden="true" /> Log out
          </button>
        </div>
      )}
    </div>
  );
}
