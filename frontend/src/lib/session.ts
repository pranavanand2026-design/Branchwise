import { create } from "zustand";
import { api, type Brand, type Health, type Meta, type User } from "./api";

type Status = "loading" | "ready" | "error";

type SessionStore = {
  status: Status;
  error: string | null;
  user: User | null;
  brand: Brand | null;
  meta: Meta | null;
  health: Health | null;
  bootstrap: () => Promise<void>;
  setSession: (user: User | null, brand: Brand | null) => void;
  setBrand: (brand: Brand) => void;
  setUser: (user: User) => void;
  logout: () => Promise<void>;
};

export const useSession = create<SessionStore>((set, get) => ({
  status: "loading",
  error: null,
  user: null,
  brand: null,
  meta: null,
  health: null,

  bootstrap: async () => {
    set({ status: "loading", error: null });
    try {
      const [me, meta, health] = await Promise.all([api.me(), api.meta(), api.health().catch(() => null)]);
      set({ user: me.user, brand: me.brand, meta, health, status: "ready" });
    } catch (e) {
      set({ status: "error", error: (e as Error).message });
    }
  },
  setSession: (user, brand) => set({ user, brand }),
  setBrand: (brand) => set({ brand }),
  setUser: (user) => set({ user }),
  logout: async () => {
    try {
      await api.logout();
    } finally {
      set({ user: null, brand: null });
      void get();
    }
  },
}));

export function verticalLabel(meta: Meta | null, key: string | undefined): string {
  return meta?.verticals.find((v) => v.key === key)?.label ?? key ?? "";
}
