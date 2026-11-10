import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import ReactMarkdown from "react-markdown";
import { ArrowUp, Bookmark, Check, GraduationCap, MapPin, RotateCcw, Search, SlidersHorizontal, TrainFront } from "lucide-react";
import { api, type AssistantAction, type ChatMsg, type RankedSite } from "../lib/api";
import { useSession } from "../lib/session";
import { useWorkspace } from "../lib/store";
import { applyAiFilter } from "../lib/scenario";
import { ScoreBadge } from "./SitePanel";
import { LogoMark, Spinner } from "./ui";

const STARTERS = [
  { icon: GraduationCap, text: "Our customers are uni students. Where should we open next?" },
  { icon: TrainFront, text: "Find spots near stations with few competitors" },
  { icon: Search, text: "What's around Newtown for us?" },
];

const WORKING = ["Reading your brief…", "Re-weighting the map…", "Ranking areas…", "Checking competitors nearby…", "Writing it up…"];

const SHORT: Record<string, string> = {
  demographic_match: "busy streets",
  surrounding_amenities: "near unis and offices",
  transit_accessibility: "near stations",
  market_saturation: "few competitors",
  cannibalisation: "away from my stores",
};

/** "Near stations, busy streets · Inner West" */
export function scenarioLabel(priorities: Record<string, number> | null, regions: string[] | null): string {
  const meta = useSession.getState().meta;
  const top = priorities ? Object.entries(priorities).filter(([, v]) => v >= 3).map(([k]) => SHORT[k]).filter(Boolean) : [];
  const where = regions === null ? null : regions.length === 0 ? "All of Sydney"
    : regions.map((r) => meta?.regions.find((x) => x.key === r)?.label ?? r).join(", ");
  const first = top.length ? top.join(", ").replace(/^./, (c) => c.toUpperCase()) : null;
  return [first, where].filter(Boolean).join(" · ") || "Custom priorities";
}

/** Apply what Branchwise AI did to the map and lists. */
export function applyActions(actions: AssistantAction[], openSite: (h3: string, lat: number, lng: number) => void) {
  const ws = useWorkspace.getState();
  let lastFocus: Extract<AssistantAction, { type: "focus" }> | null = null;
  for (const a of actions) {
    if (a.type === "scenario") {
      ws.set({ scenario: { priorities: a.priorities, regions: a.regions, label: scenarioLabel(a.priorities, a.regions) } });
    } else if (a.type === "sites") {
      const ranked: RankedSite[] = a.sites.map((s, i) => ({
        h3_id: s.h3_id, lat: s.lat, lng: s.lng, locality: s.suburb, score: s.score, rank: i + 1,
        reasons: s.reasons, risks: s.risks, n_competitors: 0, n_complementary: 0,
        components: { market_saturation: 0, cannibalisation: 0, surrounding_amenities: 0, transit_accessibility: 0, demographic_match: 0 },
      }));
      ws.set({ ranked });
    } else if (a.type === "places") {
      ws.set({ places: a.places });
    } else if (a.type === "focus") {
      lastFocus = a;
    } else if (a.type === "saved") {
      api.shortlist().then((d) => useWorkspace.getState().set({ shortlist: d.sites })).catch(() => undefined);
    }
  }
  if (lastFocus) void openSite(lastFocus.h3_id, lastFocus.lat, lastFocus.lng);
}

function topSuburb(m: ChatMsg): string | null {
  const sites = m.actions?.find((a) => a.type === "sites");
  if (sites && sites.type === "sites" && sites.sites[0]?.suburb) return sites.sites[0].suburb;
  const focus = m.actions?.find((a) => a.type === "focus");
  return focus && focus.type === "focus" ? focus.suburb : null;
}

export function ChatPanel({ onOpenSite }: { onOpenSite: (h3: string, lat: number, lng: number) => void }) {
  const brand = useSession((s) => s.brand)!;
  const { chat, chatBusy, set } = useWorkspace();
  const [text, setText] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [chat.length, chatBusy]);

  useEffect(() => {
    if (!chatBusy) return setStep(0);
    const t = setInterval(() => setStep((s) => Math.min(s + 1, WORKING.length - 1)), 4500);
    return () => clearInterval(t);
  }, [chatBusy]);

  // grow the input with its text, up to a few lines
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [text]);

  async function send(message: string) {
    const content = message.trim();
    if (!content || chatBusy) return;
    setErr(null);
    setText("");
    const history: ChatMsg[] = [...useWorkspace.getState().chat, { role: "user", content }];
    set({ chat: history, chatBusy: true });
    try {
      const r = await api.assistant(history.map(({ role, content }) => ({ role, content })), useWorkspace.getState().scenario);
      set({ chat: [...history, { role: "assistant", content: r.reply, actions: r.actions, mode: r.mode, note: r.note }] });
      applyActions(r.actions, onOpenSite);
    } catch (e) {
      setErr((e as Error).message);
      set({ chat: history });
    } finally {
      set({ chatBusy: false });
      inputRef.current?.focus();
    }
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void send(text);
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send(text);
    }
  };

  const last = chat[chat.length - 1];
  const followTo = last?.role === "assistant" ? topSuburb(last) : null;
  const followUps = followTo
    ? [`What's around ${followTo}?`, `Save ${followTo} to my shortlist`, "Show me different options"]
    : [];

  return (
    <div className="h-full flex flex-col">
      <div className="px-5 h-16 shrink-0 border-b border-bg-border flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <LogoMark size={26} />
          <div className="min-w-0">
            <h2 className="text-[17px] leading-tight">Branchwise AI</h2>
            <p className="text-[13px] text-fg-tertiary leading-tight">Personalised site picks</p>
          </div>
        </div>
        {chat.length > 0 && (
          <button
            className="w-9 h-9 grid place-items-center rounded-full text-fg-tertiary hover:bg-bg-elevated hover:text-fg-primary"
            onClick={() => set({ chat: [], places: [] })}
            disabled={chatBusy}
            aria-label="Start a new chat"
            title="New chat"
          >
            <RotateCcw size={17} />
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-6 space-y-6" aria-live="polite">
        {chat.length === 0 && (
          <div className="pt-4">
            <p className="font-display text-[22px] leading-snug">Where should {brand.name} open next?</p>
            <p className="mt-2 text-[15px] text-fg-secondary leading-relaxed">
              Tell me about your customers and I'll rank areas, check competitors and explain my picks.
            </p>
            <div className="mt-6 space-y-2">
              {STARTERS.map(({ icon: Icon, text }) => (
                <button
                  key={text}
                  onClick={() => void send(text)}
                  className="w-full flex items-center gap-3 text-left px-4 py-3 rounded-md border border-bg-border bg-white text-[15px] hover:border-accent-blue hover:-translate-y-px transition-[border-color,transform]"
                >
                  <Icon size={18} className="text-accent-link shrink-0" aria-hidden="true" />
                  {text}
                </button>
              ))}
            </div>
          </div>
        )}

        {chat.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="flex justify-end">
              <div className="max-w-[85%] rounded-2xl rounded-br-md bg-brand-navy text-brand-mint px-4 py-2.5 text-[15px] leading-relaxed whitespace-pre-wrap">
                {m.content}
              </div>
            </div>
          ) : (
            <AssistantMessage key={i} m={m} onOpenSite={onOpenSite} isLast={i === chat.length - 1} />
          )
        )}

        {chatBusy && (
          <div className="flex items-center gap-3" role="status">
            <LogoMark size={22} />
            <span className="flex items-center gap-2 text-sm text-fg-tertiary">
              <Spinner className="text-accent-blue" /> {WORKING[step]}
            </span>
          </div>
        )}
        {err && <p className="text-sm text-danger" role="alert">{err}</p>}

        {!chatBusy && followUps.length > 0 && (
          <div className="flex flex-wrap gap-2 pl-9">
            {followUps.map((f) => (
              <button
                key={f}
                onClick={() => void send(f)}
                className="h-8 px-3 rounded-full border border-bg-border bg-white text-[13px] text-fg-secondary hover:border-accent-blue hover:text-fg-primary transition-colors"
              >
                {f}
              </button>
            ))}
          </div>
        )}
        <div ref={endRef} />
      </div>

      <form onSubmit={onSubmit} className="p-4 pt-3 border-t border-bg-border">
        <div className="flex items-end gap-2 rounded-2xl border border-bg-border bg-bg-base px-3 py-2 focus-within:border-accent-blue focus-within:bg-white transition-colors">
          <label htmlFor="chat-input" className="sr-only">Message Branchwise AI</label>
          <textarea
            id="chat-input"
            ref={inputRef}
            rows={1}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKey}
            maxLength={1000}
            placeholder="Describe your customers or ask about an area"
            className="flex-1 resize-none bg-transparent py-1.5 text-[15px] leading-relaxed outline-none placeholder:text-fg-tertiary"
          />
          <button
            type="submit"
            disabled={!text.trim() || chatBusy}
            className="w-9 h-9 shrink-0 grid place-items-center rounded-full bg-accent text-white disabled:opacity-30 transition-opacity"
            aria-label="Send"
          >
            <ArrowUp size={18} aria-hidden="true" />
          </button>
        </div>
        <p className="mt-2 text-[12px] text-fg-tertiary text-center">AI picks come from Foursquare place data. Check sites in person.</p>
      </form>
    </div>
  );
}

function AssistantMessage({ m, onOpenSite, isLast }: { m: ChatMsg; onOpenSite: (h3: string, lat: number, lng: number) => void; isLast: boolean }) {
  const scenario = useWorkspace((s) => s.scenario);
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState(false);
  const sites = m.actions?.find((a) => a.type === "sites");
  const places = m.actions?.filter((a) => a.type === "places") ?? [];
  const saved = m.actions?.filter((a) => a.type === "saved") ?? [];
  const filter = [...(m.actions ?? [])].reverse().find((a) => a.type === "scenario");

  return (
    <div className="flex gap-3">
      <span className="mt-0.5 shrink-0"><LogoMark size={22} /></span>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium text-fg-tertiary mb-1">Branchwise AI</p>
        <div className="text-[15px] leading-relaxed text-fg-primary">
          <ReactMarkdown
            components={{
              p: ({ children }) => <p className="mb-3 last:mb-0">{children}</p>,
              strong: ({ children }) => <strong className="font-semibold text-fg-primary">{children}</strong>,
              ul: ({ children }) => <ul className="mb-3 space-y-2 pl-4 list-disc marker:text-fg-tertiary">{children}</ul>,
              ol: ({ children }) => <ol className="mb-3 space-y-2 pl-5 list-decimal marker:text-fg-tertiary marker:font-medium">{children}</ol>,
              li: ({ children }) => <li className="pl-1">{children}</li>,
            }}
          >
            {m.content}
          </ReactMarkdown>
        </div>

        {sites && sites.type === "sites" && sites.sites.length > 0 && (
          <ul className="mt-3 rounded-md border border-bg-border bg-white divide-y divide-bg-border overflow-hidden">
            {sites.sites.slice(0, 4).map((s, i) => (
              <li key={s.h3_id}>
                <button
                  onClick={() => onOpenSite(s.h3_id, s.lat, s.lng)}
                  className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-bg-base transition-colors"
                >
                  <span className="w-4 text-[13px] text-fg-tertiary tabular">{i + 1}</span>
                  <span className="flex-1 min-w-0 font-display text-[15px] truncate">{s.suburb ?? "Sydney"}</span>
                  <ScoreBadge score={s.score} />
                </button>
              </li>
            ))}
          </ul>
        )}

        {filter && filter.type === "scenario" && isLast && scenario && (
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md bg-accent-soft px-3 py-2">
            <SlidersHorizontal size={15} className="text-accent-link shrink-0" aria-hidden="true" />
            <span className="text-[13px] text-fg-secondary flex-1 min-w-[140px]">{scenario.label}</span>
            <button
              className="btn-sm btn bg-brand-navy text-white hover:bg-accent-hover h-8"
              disabled={applying || applied}
              onClick={async () => {
                setApplying(true);
                try { await applyAiFilter(); setApplied(true); } finally { setApplying(false); }
              }}
            >
              {applying ? <Spinner /> : applied ? <Check size={15} aria-hidden="true" /> : null}
              {applied ? "Applied" : "Apply AI suggested filter"}
            </button>
          </div>
        )}

        <div className="mt-2 flex flex-wrap gap-2">
          {places.map((p, i) =>
            p.type === "places" ? (
              <span key={i} className="inline-flex items-center gap-1.5 text-[13px] text-fg-secondary bg-bg-elevated rounded-full px-3 py-1">
                <MapPin size={13} aria-hidden="true" /> {p.places.length} of {p.total} “{p.query}” on the map
              </span>
            ) : null
          )}
          {saved.map((s, i) =>
            s.type === "saved" ? (
              <span key={i} className="inline-flex items-center gap-1.5 text-[13px] text-fg-secondary bg-bg-elevated rounded-full px-3 py-1">
                <Bookmark size={13} aria-hidden="true" /> Saved {s.suburb ?? "the area"}
              </span>
            ) : null
          )}
        </div>
        {m.note && <p className="mt-2 text-[13px] text-[#9A5B00]">{m.note}</p>}
      </div>
    </div>
  );
}
