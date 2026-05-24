import type { CopyPlan, CopyPlanItem, MissingSample, ParsedRom, RomAsset, RomEntry, SamplePlan, SamplePlanItem } from './types';

const OPTIONAL_SOUNDTRACK_SAMPLE_IDS: Record<string, string> = {
  ddragon: 'ddragon',
  ffight: 'ffight',
  mk: 'mkla1',
  moonwalk: 'moonwlkb',
  nbajam: 'nbajam',
  outrun: 'outrun',
};

export function enrichRomEntries(
  parsed: ParsedRom[],
  fullAssets: Map<string, RomAsset>,
  targetAssets: Map<string, RomAsset>,
): RomEntry[] {
  const byId = new Map(parsed.map((entry) => [entry.id.toLowerCase(), entry]));

  return parsed.map((entry) => {
    const fullAsset = fullAssets.get(entry.id.toLowerCase());
    const targetAsset = targetAssets.get(entry.id.toLowerCase());
    const parentId = entry.cloneOf || entry.romOf;
    const parent = parentId ? byId.get(parentId.toLowerCase()) : undefined;

    return {
      ...entry,
      available: Boolean(fullAsset),
      fullAsset,
      fullAssetName: fullAsset?.name || '',
      inTarget: Boolean(targetAsset),
      targetAsset,
      targetAssetName: targetAsset?.name || '',
      parentTitle: parent?.title || '',
    };
  });
}

export function buildCopyPlan(
  selectedIds: Iterable<string>,
  entries: RomEntry[],
  targetAssets: Map<string, RomAsset>,
  includeDependencies: boolean,
): CopyPlan {
  const byId = new Map(entries.map((entry) => [entry.id.toLowerCase(), entry]));
  const items: CopyPlanItem[] = [];
  const missing: RomEntry[] = [];
  const alreadyPresent: RomEntry[] = [];
  const seenAssetNames = new Set<string>();
  const seenMissingIds = new Set<string>();
  const seenPresentIds = new Set<string>();
  const processingIds = new Set<string>();

  for (const id of selectedIds) {
    addEntry(id, 'selected');
  }

  return { items, missing, alreadyPresent };

  function addEntry(id: string, reason: CopyPlanItem['reason']) {
    const key = id.toLowerCase();
    if (processingIds.has(key)) {
      return;
    }

    const entry = byId.get(key);
    if (!entry) {
      return;
    }

    processingIds.add(key);

    if (includeDependencies) {
      for (const dependency of [entry.romOf, entry.cloneOf]) {
        if (dependency && dependency.toLowerCase() !== key) {
          addEntry(dependency, 'dependency');
        }
      }
    }

    if (targetAssets.has(key)) {
      if (!seenPresentIds.has(key)) {
        alreadyPresent.push(entry);
        seenPresentIds.add(key);
      }
      processingIds.delete(key);
      return;
    }

    if (!entry.fullAsset) {
      if (!seenMissingIds.has(key)) {
        missing.push(entry);
        seenMissingIds.add(key);
      }
      processingIds.delete(key);
      return;
    }

    const assetKey = entry.fullAsset.name.toLowerCase();
    if (seenAssetNames.has(assetKey)) {
      processingIds.delete(key);
      return;
    }

    seenAssetNames.add(assetKey);
    items.push({
      entry,
      asset: entry.fullAsset,
      reason,
    });
    processingIds.delete(key);
  }
}

export function buildSamplePlan(
  selectedIds: Iterable<string>,
  entries: RomEntry[],
  sampleSourceAssets: Map<string, RomAsset>,
  sampleTargetAssets: Map<string, RomAsset>,
): SamplePlan {
  const byId = new Map(entries.map((entry) => [entry.id.toLowerCase(), entry]));
  const items: SamplePlanItem[] = [];
  const missing: MissingSample[] = [];
  const alreadyPresent: MissingSample[] = [];
  const required: MissingSample[] = [];
  const seenSampleIds = new Set<string>();

  for (const id of selectedIds) {
    const entry = byId.get(id.toLowerCase());
    if (!entry) {
      continue;
    }

    for (const sampleId of entry.sampleArchiveIds) {
      const key = sampleId.toLowerCase();
      if (seenSampleIds.has(key)) {
        continue;
      }

      seenSampleIds.add(key);
      const requiredSample = { entry, sampleId };
      required.push(requiredSample);

      if (sampleTargetAssets.has(key)) {
        alreadyPresent.push(requiredSample);
        continue;
      }

      const asset = sampleSourceAssets.get(key);
      if (!asset) {
        missing.push(requiredSample);
        continue;
      }

      items.push({ entry, asset, sampleId });
    }
  }

  return {
    alreadyPresent,
    items,
    missing,
    required,
  };
}

export function buildSoundtrackPlan(
  selectedIds: Iterable<string>,
  entries: RomEntry[],
  soundtrackSourceAssets: Map<string, RomAsset>,
  sampleTargetAssets: Map<string, RomAsset>,
): SamplePlan {
  const byId = new Map(entries.map((entry) => [entry.id.toLowerCase(), entry]));
  const items: SamplePlanItem[] = [];
  const missing: MissingSample[] = [];
  const alreadyPresent: MissingSample[] = [];
  const required: MissingSample[] = [];
  const seenSoundtracks = new Set<string>();

  for (const id of selectedIds) {
    const entry = byId.get(id.toLowerCase());
    const sampleId = entry ? getSoundtrackSampleId(entry) : '';
    if (!entry || !sampleId || seenSoundtracks.has(sampleId)) {
      continue;
    }

    seenSoundtracks.add(sampleId);
    const requiredSample = { entry, sampleId };
    required.push(requiredSample);

    if (sampleTargetAssets.has(sampleId)) {
      alreadyPresent.push(requiredSample);
      continue;
    }

    const asset = soundtrackSourceAssets.get(sampleId);
    if (!asset) {
      missing.push(requiredSample);
      continue;
    }

    items.push({ entry, asset, sampleId });
  }

  return {
    alreadyPresent,
    items,
    missing,
    required,
  };
}

export function getScreenscraperUrl(entry: RomEntry) {
  const query = `${entry.title} ${entry.id}`.replace(/\s+/g, ' ').trim();
  return `https://www.screenscraper.fr/recherche.php?recherche=${encodeURIComponent(query)}`;
}

export function getRegionOptions(entries: RomEntry[]) {
  return Array.from(new Set(entries.map((entry) => entry.region).filter(Boolean))).sort((left, right) =>
    left.localeCompare(right),
  );
}

function getSoundtrackSampleId(entry: RomEntry) {
  const candidates = [entry.id, entry.cloneOf, entry.romOf].map((id) => id.toLowerCase()).filter(Boolean);
  for (const id of candidates) {
    const sampleId = OPTIONAL_SOUNDTRACK_SAMPLE_IDS[id];
    if (sampleId) {
      return sampleId;
    }
  }

  return '';
}
