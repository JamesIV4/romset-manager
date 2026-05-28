import type {
  CopyPlan,
  CopyPlanItem,
  CounterpartPlanItem,
  MissingSample,
  ParsedRom,
  RomAsset,
  RomEntry,
  SamplePlan,
  SamplePlanItem,
} from './types';

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
  counterpartAssets: Map<string, RomAsset> = new Map(),
  counterpartTargetAssets: Map<string, RomAsset> = new Map(),
): RomEntry[] {
  const byId = new Map(parsed.map((entry) => [entry.id.toLowerCase(), entry]));

  return parsed.map((entry) => {
    const key = entry.id.toLowerCase();
    const fullAsset = fullAssets.get(key);
    const targetAsset = targetAssets.get(key);
    const counterpartAsset = counterpartAssets.get(key);
    const counterpartTargetAsset = counterpartTargetAssets.get(key);
    const parentId = entry.cloneOf || entry.romOf;
    const parent = parentId ? byId.get(parentId.toLowerCase()) : undefined;

    return {
      ...entry,
      available: Boolean(fullAsset),
      counterpartAvailable: Boolean(counterpartAsset),
      counterpartAsset,
      counterpartAssetName: counterpartAsset?.name || '',
      counterpartInTarget: Boolean(counterpartTargetAsset),
      counterpartTargetAsset,
      counterpartTargetAssetName: counterpartTargetAsset?.name || '',
      fullAsset,
      fullAssetName: fullAsset?.name || '',
      inTarget: Boolean(targetAsset),
      targetAsset,
      targetAssetName: targetAsset?.name || '',
      parentTitle: parent?.title || '',
    };
  });
}

export function buildAssetBackedEntries(
  sourceAssets: Map<string, RomAsset>,
  targetAssets: Map<string, RomAsset>,
  metadataEntries: ParsedRom[] = [],
  fallbackMetadataEntries: ParsedRom[] = [],
): ParsedRom[] {
  const metadataById = new Map(metadataEntries.map((entry) => [entry.id.toLowerCase(), entry]));
  const fallbackMetadataById = new Map(fallbackMetadataEntries.map((entry) => [entry.id.toLowerCase(), entry]));
  const ids = new Set([...sourceAssets.keys(), ...targetAssets.keys()]);

  return [...ids]
    .map((id) => {
      const asset = sourceAssets.get(id) ?? targetAssets.get(id);
      const metadata = metadataById.get(id);
      const fallbackMetadata = fallbackMetadataById.get(id);

      if (metadata && fallbackMetadata && isWeakAssetTitle(metadata, id, asset)) {
        return mergeFallbackMetadata(metadata, fallbackMetadata);
      }

      if (metadata) {
        return metadata;
      }

      if (fallbackMetadata) {
        return fallbackMetadata;
      }

      return createAssetEntry(id, asset);
    })
    .sort((left, right) => left.title.localeCompare(right.title));
}

function isWeakAssetTitle(entry: ParsedRom, id: string, asset?: RomAsset) {
  const titleKey = normalizeMetadataTitle(entry.title);
  return (
    titleKey === normalizeMetadataTitle(id) ||
    titleKey === normalizeMetadataTitle(asset?.baseName || '') ||
    titleKey === normalizeMetadataTitle(asset?.name || '')
  );
}

function mergeFallbackMetadata(entry: ParsedRom, fallback: ParsedRom): ParsedRom {
  return {
    ...entry,
    title: fallback.title || entry.title,
    region: entry.region === 'Unknown' ? fallback.region : entry.region,
    year: entry.year || fallback.year,
    manufacturer: entry.manufacturer || fallback.manufacturer,
    players: entry.players || fallback.players,
    buttons: entry.buttons || fallback.buttons,
    controls: entry.controls || fallback.controls,
    coins: entry.coins || fallback.coins,
    genre: entry.genre || fallback.genre,
    searchText: [entry.id, fallback.title, entry.title, entry.category, fallback.searchText].filter(Boolean).join(' ').toLowerCase(),
  };
}

function normalizeMetadataTitle(value: string) {
  return value.toLowerCase().replace(/\.zip$/i, '').replace(/[^a-z0-9]+/g, '');
}

function createAssetEntry(id: string, asset?: RomAsset): ParsedRom {
  const title = asset?.baseName || id;

  return {
    id,
    title,
    region: 'Unknown',
    year: '',
    manufacturer: '',
    players: '',
    buttons: '',
    controls: '',
    coins: '',
    genre: '',
    category: '',
    cloneOf: '',
    romOf: '',
    sampleOf: '',
    sampleArchiveIds: [],
    sampleNames: [],
    driverName: '',
    display: '',
    driverStatus: '',
    isBios: id === 'neogeo',
    isRunnable: id !== 'neogeo',
    romCount: asset ? 1 : 0,
    romSize: asset?.size ?? 0,
    searchText: [id, title, asset?.name].filter(Boolean).join(' ').toLowerCase(),
  };
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

export function buildMatchingSamplePlan(
  selectedIds: Iterable<string>,
  entries: RomEntry[],
  sampleSourceAssets: Map<string, RomAsset>,
  sampleTargetAssets: Map<string, RomAsset>,
): SamplePlan {
  const entriesWithSamples = entries.map((entry) => ({
    ...entry,
    sampleArchiveIds: getMatchingSampleIds(entry, sampleSourceAssets, sampleTargetAssets),
  }));

  return buildSamplePlan(selectedIds, entriesWithSamples, sampleSourceAssets, sampleTargetAssets);
}

function getMatchingSampleIds(
  entry: RomEntry,
  sampleSourceAssets: Map<string, RomAsset>,
  sampleTargetAssets: Map<string, RomAsset>,
) {
  const ids = [entry.id, entry.cloneOf, entry.romOf].map((id) => id.toLowerCase()).filter(Boolean);
  return ids.filter((id, index) => ids.indexOf(id) === index && (sampleSourceAssets.has(id) || sampleTargetAssets.has(id)));
}

export function buildCounterpartPlan(
  selectedIds: Iterable<string>,
  entries: RomEntry[],
  primaryTargetDirectory: FileSystemDirectoryHandle | null,
  counterpartTargetDirectory: FileSystemDirectoryHandle | null,
  removeSourceAfterCopy: boolean,
): CounterpartPlanItem[] {
  const byId = new Map(entries.map((entry) => [entry.id.toLowerCase(), entry]));
  const items: CounterpartPlanItem[] = [];
  const seen = new Set<string>();

  for (const id of selectedIds) {
    const entry = byId.get(id.toLowerCase());
    if (!entry) {
      continue;
    }

    if (entry.inTarget && !entry.counterpartInTarget && entry.counterpartAsset && counterpartTargetDirectory) {
      addItem({
        direction: 'primaryToCounterpart',
        entry,
        removeAsset: removeSourceAfterCopy ? entry.targetAsset : undefined,
        removeTarget: removeSourceAfterCopy ? primaryTargetDirectory ?? undefined : undefined,
        sourceAsset: entry.counterpartAsset,
        targetDirectory: counterpartTargetDirectory,
      });
    }

    if (entry.counterpartInTarget && !entry.inTarget && entry.fullAsset && primaryTargetDirectory) {
      addItem({
        direction: 'counterpartToPrimary',
        entry,
        removeAsset: removeSourceAfterCopy ? entry.counterpartTargetAsset : undefined,
        removeTarget: removeSourceAfterCopy ? counterpartTargetDirectory ?? undefined : undefined,
        sourceAsset: entry.fullAsset,
        targetDirectory: primaryTargetDirectory,
      });
    }
  }

  return items;

  function addItem(item: CounterpartPlanItem) {
    const key = `${item.direction}:${item.sourceAsset.name.toLowerCase()}`;
    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    items.push(item);
  }
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
