// Apply the AI's suggested filter (priorities + areas) to the saved brand profile.
import { api } from "./api";
import { useSession } from "./session";
import { useWorkspace } from "./store";

export async function applyAiFilter(): Promise<void> {
  const { brand, setBrand } = useSession.getState();
  const { scenario, set } = useWorkspace.getState();
  if (!brand || !scenario) return;
  const b = await api.saveBrand({
    name: brand.name,
    vertical: brand.vertical,
    description: brand.description,
    store_format: brand.store_format,
    store_count_band: brand.store_count_band,
    priorities: scenario.priorities ?? brand.priorities,
    regions: scenario.regions ?? brand.regions,
    onboarded: true,
  });
  setBrand(b);
  set({ scenario: null, rankedRegions: null });
}
