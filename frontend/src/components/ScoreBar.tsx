import { motion } from "framer-motion";
import { scoreHex } from "../lib/colors";
import { useSession } from "../lib/session";
import type { SignalKey } from "../lib/api";

export function ScoreBar({ name, value, weight }: { name: SignalKey; value: number; weight?: number }) {
  const meta = useSession((s) => s.meta);
  const label = meta?.signals.find((s) => s.key === name)?.label ?? name;
  return (
    <div>
      <div className="flex justify-between items-baseline text-sm">
        <span className="text-fg-secondary">{label}</span>
        <span className="tabular font-medium">
          {value}
          {weight != null && <span className="text-fg-tertiary font-normal"> · {Math.round(weight)}% weight</span>}
        </span>
      </div>
      <div className="mt-1.5 h-1.5 rounded-full bg-bg-elevated overflow-hidden">
        <motion.div
          className="h-full rounded-full"
          style={{ backgroundColor: scoreHex(value) }}
          initial={{ width: 0 }}
          animate={{ width: `${value}%` }}
          transition={{ duration: 0.5, ease: "easeOut" }}
        />
      </div>
    </div>
  );
}
