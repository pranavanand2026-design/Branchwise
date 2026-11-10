import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import ReactMarkdown from "react-markdown";
import { ArrowUp, Bookmark, MapPin, RotateCcw, Sparkles } from "lucide-react";
import { api, type AssistantAction, type ChatMsg, type RankedSite } from "../lib/api";
import { useSession } from "../lib/session";
import { useWorkspace } from "../lib/store";
import { ScoreBadge } from "./SitePanel";

const SUGGESTIONS = [
  "Our customers are uni students. Where should we open next?",
  "Find spots near train stations with few competitors",
  "How does Newtown compare for us?",
  "Where are the Chatime stores in the Inner West?",
];

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

/** Apply what the assistant did to the map and lists. */
export function applyActions(actions: AssistantAction[], openSite: (h3: string, lat: number, lng: number) => void) {
  const ws = useWorkspace.getState();
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
      void openSite(a.h3_id, a.lat, a.lng);
    } else if (a.type === "saved") {
      api.shortlist().then((d) => useWorkspace.getState().set({ shortlist: d.sites })).catch(() => undefined);
    }
  }
}

export function ChatPanel({ onOpenSite }: { onOpenSite: (h3: string, lat: number, lng: number) => void }) {
  const brand = useSession((s) => s.brand)!;
  const health = useSession((s) => s.health);
  const { chat, chatBusy, set } = useWorkspace();
  const [text, setText] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [chat.length, chatBusy]);

  async function send(message: string) {
    const content = message.trim();
    if (!content || chatBusy) return;
    setErr(null);
    setText("");
    const history: ChatMsg[] = [...useWorkspace.getState().chat, { role: "user", content }];
    set({ chat: history, chatBusy: true });
    try {
      const r = await api.assistant(
        history.map(({ role, content }) => ({ role, content })),
        useWorkspace.getState().scenario
      );
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

  const live = health?.assistant?.provider === "groq";

  return (
    <div className="h-full flex flex-col">
      <div className="px-5 pt-5 pb-4 border-b border-bg-border flex items-start justify-between gap-3">
        <div>
          <h2 className="text-[22px] leading-tight">Assistant</h2>
          <p className="mt-1 text-sm text-fg-tertiary">
            {live ? "Ask in plain words. It re-weights the map and finds places for you." : "Running on built-in rules. Add a Groq key for the full assistant."}
          </p>
        </div>
        {chat.length > 0 && (
          <button
            className="btn-quiet btn-sm shrink-0"
            onClick={() => set({ chat: [], places: [] })}
            disabled={chatBusy}
          >
            <RotateCcw size={15} aria-hidden="true" /> New chat
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5" aria-live="polite">
        {chat.length === 0 && (
          <div>
            <div className="w-10 h-10 rounded-full bg-accent-soft text-accent-link grid place-items-center">
              <Sparkles size={20} aria-hidden="true" />
            </div>
            <p className="mt-4 text-[17px] leading-relaxed">
              Hi! Tell me about {brand.name}'s customers or what you're looking for, and I'll find the best areas and explain why.
            </p>
            <div className="mt-5 flex flex-col gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => void send(s)}
                  className="text-left px-4 py-3 rounded-md border border-bg-border bg-white text-[15px] hover:border-accent-blue hover:bg-accent-soft/40 transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {chat.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="flex justify-end">
              <div className="max-w-[85%] rounded-lg rounded-br-sm bg-brand-navy text-brand-mint px-4 py-2.5 text-[15px] leading-relaxed whitespace-pre-wrap">
                {m.content}
              </div>
            </div>
          ) : (
            <AssistantMessage key={i} m={m} onOpenSite={onOpenSite} />
          )
        )}

        {chatBusy && (
          <div className="flex items-center gap-2 text-sm text-fg-tertiary" role="status">
            <span className="flex gap-1" aria-hidden="true">
              {[0, 1, 2].map((d) => (
                <span key={d} className="w-1.5 h-1.5 rounded-full bg-accent-blue animate-bounce" style={{ animationDelay: `${d * 120}ms` }} />
              ))}
            </span>
            Looking at Sydney for you…
          </div>
        )}
        {err && <p className="text-sm text-danger" role="alert">{err}</p>}
        <div ref={endRef} />
      </div>

      <form onSubmit={onSubmit} className="p-4 border-t border-bg-border">
        <div className="flex items-end gap-2 rounded-lg border border-bg-border bg-white px-3 py-2 focus-within:border-accent-blue focus-within:ring-2 focus-within:ring-accent-blue/20">
          <label htmlFor="chat-input" className="sr-only">Message the assistant</label>
          <textarea
            id="chat-input"
            ref={inputRef}
            rows={1}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKey}
            maxLength={1000}
            placeholder="Ask about an area, your customers, or competitors"
            className="flex-1 resize-none bg-transparent py-1.5 text-[15px] leading-relaxed outline-none max-h-40 placeholder:text-fg-tertiary"
          />
          <button
            type="submit"
            disabled={!text.trim() || chatBusy}
            className="w-9 h-9 shrink-0 grid place-items-center rounded-full bg-accent text-white disabled:opacity-40 transition-opacity"
            aria-label="Send"
          >
            <ArrowUp size={18} aria-hidden="true" />
          </button>
        </div>
      </form>
    </div>
  );
}

function AssistantMessage({ m, onOpenSite }: { m: ChatMsg; onOpenSite: (h3: string, lat: number, lng: number) => void }) {
  const sites = m.actions?.find((a) => a.type === "sites");
  const places = m.actions?.filter((a) => a.type === "places") ?? [];
  const saved = m.actions?.filter((a) => a.type === "saved") ?? [];
  return (
    <div className="max-w-[95%]">
      <div className="text-[15px] leading-relaxed text-fg-primary">
        <ReactMarkdown
          components={{
            p: ({ children }) => <p className="mb-2.5 last:mb-0">{children}</p>,
            strong: ({ children }) => <strong className="font-medium">{children}</strong>,
            ul: ({ children }) => <ul className="mb-2.5 space-y-1 pl-4 list-disc">{children}</ul>,
            ol: ({ children }) => <ol className="mb-2.5 space-y-1 pl-4 list-decimal">{children}</ol>,
          }}
        >
          {m.content}
        </ReactMarkdown>
      </div>

      {sites && sites.type === "sites" && sites.sites.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {sites.sites.slice(0, 5).map((s, i) => (
            <li key={s.h3_id}>
              <button
                onClick={() => onOpenSite(s.h3_id, s.lat, s.lng)}
                className="w-full flex items-center gap-3 px-3 py-2 rounded-md border border-bg-border bg-white text-left hover:border-accent-blue transition-colors"
              >
                <span className="w-4 text-[13px] text-fg-tertiary tabular">{i + 1}</span>
                <span className="flex-1 min-w-0">
                  <span className="block font-display text-[16px] truncate">{s.suburb ?? "Sydney"}</span>
                  {s.reasons[0] && <span className="block text-[13px] text-fg-tertiary truncate">{s.reasons[0]}</span>}
                </span>
                <ScoreBadge score={s.score} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {places.map((p, i) =>
        p.type === "places" ? (
          <p key={i} className="mt-3 inline-flex items-center gap-1.5 text-[13px] text-fg-secondary bg-accent-soft rounded-full px-3 py-1">
            <MapPin size={13} aria-hidden="true" />
            {p.places.length} of {p.total} “{p.query}” pinned on the map
          </p>
        ) : null
      )}
      {saved.map((s, i) =>
        s.type === "saved" ? (
          <p key={i} className="mt-3 inline-flex items-center gap-1.5 text-[13px] text-fg-secondary bg-accent-soft rounded-full px-3 py-1">
            <Bookmark size={13} aria-hidden="true" /> Saved {s.suburb ?? "the area"} to your shortlist
          </p>
        ) : null
      )}
      {m.note && <p className="mt-2 text-[13px] text-[#9A5B00]">{m.note}</p>}
    </div>
  );
}
