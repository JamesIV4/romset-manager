import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Check,
  CheckCheck,
  CircleAlert,
  Copy,
  Database,
  ExternalLink,
  FileCode2,
  FolderOpen,
  ListChecks,
  Loader2,
  PackageOpen,
  RefreshCw,
  Search,
  Settings2,
  Trash2,
  X,
} from 'lucide-react';
import {
  copyAssetToDirectory,
  listSampleAssets,
  listRomAssets,
  loadHandles,
  pickFullDirectory,
  pickSampleSourceDirectory,
  pickSampleTargetDirectory,
  pickSoundtrackSourceDirectory,
  pickTargetDirectory,
  pickXmlFile,
  removeAssetFromDirectory,
  resolveRomDirectory,
  resolveSampleDirectory,
  resolveSoundtrackDirectory,
  saveHandle,
  supportsFileSystemAccess,
  verifyPermission,
} from './lib/fileSystem';
import { formatBytes, parseMameXml } from './lib/mameParser';
import { buildCopyPlan, buildSamplePlan, buildSoundtrackPlan, enrichRomEntries, getRegionOptions, getScreenscraperUrl } from './lib/romData';
import type { CopyPlan, ParsedRom, RomAsset, RomEntry, SamplePlan, SourceHandles, SourceKey } from './lib/types';

type ViewFilter = 'missing' | 'inSet' | 'all' | 'selected' | 'unavailable';
type SortKey = 'title' | 'region' | 'year' | 'manufacturer';

type CopyProgress = {
  current: number;
  total: number;
  label: string;
};

type RemoveItem = {
  asset: RomAsset;
  entry: RomEntry;
};

type SourceStatus = {
  detail: string;
  state: 'empty' | 'checking' | 'ready' | 'warning';
  selectedName?: string;
};

const EMPTY_HANDLES: SourceHandles = {
  fullDir: null,
  sampleSourceDir: null,
  sampleTargetDir: null,
  soundtrackSourceDir: null,
  xmlFile: null,
  targetDir: null,
};

const SOURCE_CONFIG: Array<{
  key: SourceKey;
  label: string;
  detail: string;
  suggestedPath: string;
  icon: typeof FolderOpen;
}> = [
  {
    key: 'fullDir',
    label: 'Full set',
    detail: 'Source ROMs',
    suggestedPath: 'D:\\Downloads\\mame2003-plus',
    icon: Database,
  },
  {
    key: 'xmlFile',
    label: 'MAME XML',
    detail: 'Game metadata',
    suggestedPath: 'D:\\Downloads\\mame2003-plus\\MAME 2003-Plus - 2018-12-31.xml',
    icon: FileCode2,
  },
  {
    key: 'targetDir',
    label: 'Playing set',
    detail: 'Managed ROMs',
    suggestedPath: '\\\\PACMAN\\share\\roms\\mame\\mame2003plus',
    icon: FolderOpen,
  },
  {
    key: 'sampleSourceDir',
    label: 'Sample source',
    detail: 'Optional audio samples',
    suggestedPath: 'D:\\Downloads\\mame2003-plus\\samples',
    icon: PackageOpen,
  },
  {
    key: 'sampleTargetDir',
    label: 'Sample target',
    detail: 'Optional device sample destination',
    suggestedPath: '\\\\PACMAN\\share\\bios\\mame2003-plus\\samples',
    icon: PackageOpen,
  },
  {
    key: 'soundtrackSourceDir',
    label: 'OST source',
    detail: 'Optional soundtrack samples',
    suggestedPath: 'D:\\Downloads\\mame2003-plus\\optional soundtrack samples',
    icon: PackageOpen,
  },
];

const VIEW_OPTIONS: Array<{ key: ViewFilter; label: string }> = [
  { key: 'missing', label: 'Missing' },
  { key: 'inSet', label: 'In set' },
  { key: 'selected', label: 'Selected' },
  { key: 'unavailable', label: 'No source' },
  { key: 'all', label: 'All' },
];

const EMPTY_SOURCE_STATUS: Record<SourceKey, SourceStatus> = {
  fullDir: {
    detail: 'Choose the full set folder or its roms subfolder.',
    state: 'empty',
  },
  xmlFile: {
    detail: 'Choose the MAME XML metadata file.',
    state: 'empty',
  },
  targetDir: {
    detail: 'Choose the mame2003plus playing-set folder.',
    state: 'empty',
  },
  sampleSourceDir: {
    detail: 'Auto-detected from the full set when possible, or choose a samples folder.',
    state: 'empty',
  },
  sampleTargetDir: {
    detail: 'Choose where this device expects MAME 2003-Plus samples.',
    state: 'empty',
  },
  soundtrackSourceDir: {
    detail: 'Auto-detected from the full set when possible, or choose the optional soundtrack samples folder.',
    state: 'empty',
  },
};

export function App() {
  const [handles, setHandles] = useState<SourceHandles>(EMPTY_HANDLES);
  const [parsedEntries, setParsedEntries] = useState<ParsedRom[]>([]);
  const [fullAssets, setFullAssets] = useState<Map<string, RomAsset>>(new Map());
  const [targetAssets, setTargetAssets] = useState<Map<string, RomAsset>>(new Map());
  const [sampleSourceAssets, setSampleSourceAssets] = useState<Map<string, RomAsset>>(new Map());
  const [sampleTargetAssets, setSampleTargetAssets] = useState<Map<string, RomAsset>>(new Map());
  const [soundtrackSourceAssets, setSoundtrackSourceAssets] = useState<Map<string, RomAsset>>(new Map());
  const [sampleTargetDirectory, setSampleTargetDirectory] = useState<FileSystemDirectoryHandle | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [view, setView] = useState<ViewFilter>('missing');
  const [region, setRegion] = useState('all');
  const [sortKey, setSortKey] = useState<SortKey>('title');
  const [hideClones, setHideClones] = useState(false);
  const [hideSystemRoms, setHideSystemRoms] = useState(true);
  const [includeDependencies, setIncludeDependencies] = useState(true);
  const [includeSamples, setIncludeSamples] = useState(true);
  const [includeSoundtracks, setIncludeSoundtracks] = useState(false);
  const [isIndexing, setIsIndexing] = useState(false);
  const [copyProgress, setCopyProgress] = useState<CopyProgress | null>(null);
  const [removeProgress, setRemoveProgress] = useState<CopyProgress | null>(null);
  const [sampleFixProgress, setSampleFixProgress] = useState<CopyProgress | null>(null);
  const [lastPlan, setLastPlan] = useState<CopyPlan | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [sourceStatuses, setSourceStatuses] = useState<Record<SourceKey, SourceStatus>>(EMPTY_SOURCE_STATUS);
  const [autoScanPending, setAutoScanPending] = useState(false);
  const [lastIndexed, setLastIndexed] = useState<Date | null>(null);

  useEffect(() => {
    if (!supportsFileSystemAccess) {
      return;
    }

    let isActive = true;
    loadHandles()
      .then((storedHandles) => {
        if (!isActive) {
          return;
        }

        setHandles(storedHandles);
        setSourceStatuses((current) => ({
          ...current,
          fullDir: storedHandles.fullDir
            ? {
                detail: 'Saved folder restored. Scan may ask for permission again.',
                selectedName: storedHandles.fullDir.name,
                state: 'ready',
              }
            : current.fullDir,
          xmlFile: storedHandles.xmlFile
            ? {
                detail: 'Saved XML restored. Scan may ask for permission again.',
                selectedName: storedHandles.xmlFile.name,
                state: 'ready',
              }
            : current.xmlFile,
          targetDir: storedHandles.targetDir
            ? {
                detail: 'Saved playing-set folder restored. Scan may ask for permission again.',
                selectedName: storedHandles.targetDir.name,
                state: 'ready',
              }
            : current.targetDir,
          sampleSourceDir: storedHandles.sampleSourceDir
            ? {
                detail: 'Saved sample source restored. Scan may ask for permission again.',
                selectedName: storedHandles.sampleSourceDir.name,
                state: 'ready',
              }
            : current.sampleSourceDir,
          sampleTargetDir: storedHandles.sampleTargetDir
            ? {
                detail: 'Saved sample target restored. Scan may ask for permission again.',
                selectedName: storedHandles.sampleTargetDir.name,
                state: 'ready',
              }
            : current.sampleTargetDir,
          soundtrackSourceDir: storedHandles.soundtrackSourceDir
            ? {
                detail: 'Saved OST source restored. Scan may ask for permission again.',
                selectedName: storedHandles.soundtrackSourceDir.name,
                state: 'ready',
              }
            : current.soundtrackSourceDir,
        }));
        const hasAnyStoredHandle = Object.values(storedHandles).some(Boolean);
        const hasAllStoredHandles = Boolean(storedHandles.fullDir && storedHandles.xmlFile && storedHandles.targetDir);
        if (hasAllStoredHandles) {
          setMessage('Saved sources restored. Indexing automatically...');
          setAutoScanPending(true);
        } else if (hasAnyStoredHandle) {
          setMessage('Saved sources restored.');
        }
      })
      .catch(() => {
        setMessage('');
      });

    return () => {
      isActive = false;
    };
  }, []);

  const entries = useMemo(
    () => enrichRomEntries(parsedEntries, fullAssets, targetAssets),
    [fullAssets, parsedEntries, targetAssets],
  );

  const selectedPlan = useMemo(
    () => buildCopyPlan(selectedIds, entries, targetAssets, includeDependencies),
    [entries, includeDependencies, selectedIds, targetAssets],
  );

  const selectedSamplePlan = useMemo<SamplePlan>(
    () =>
      includeSamples
        ? buildSamplePlan(selectedIds, entries, sampleSourceAssets, sampleTargetAssets)
        : {
            alreadyPresent: [],
            items: [],
            missing: [],
            required: [],
          },
    [entries, includeSamples, sampleSourceAssets, sampleTargetAssets, selectedIds],
  );

  const selectedSoundtrackPlan = useMemo<SamplePlan>(
    () =>
      includeSoundtracks
        ? buildSoundtrackPlan(selectedIds, entries, soundtrackSourceAssets, sampleTargetAssets)
        : {
            alreadyPresent: [],
            items: [],
            missing: [],
            required: [],
          },
    [entries, includeSoundtracks, sampleTargetAssets, selectedIds, soundtrackSourceAssets],
  );

  const playSetSamplePlan = useMemo<SamplePlan>(
    () =>
      buildSamplePlan(
        entries.filter((entry) => entry.inTarget).map((entry) => entry.id),
        entries,
        sampleSourceAssets,
        sampleTargetAssets,
      ),
    [entries, sampleSourceAssets, sampleTargetAssets],
  );

  const selectedRemoveItems = useMemo(() => {
    const items: RemoveItem[] = [];
    const seenAssets = new Set<string>();

    for (const entry of entries) {
      if (!selectedIds.has(entry.id) || !entry.targetAsset) {
        continue;
      }

      const assetKey = entry.targetAsset.name.toLowerCase();
      if (seenAssets.has(assetKey)) {
        continue;
      }

      seenAssets.add(assetKey);
      items.push({ asset: entry.targetAsset, entry });
    }

    return items;
  }, [entries, selectedIds]);

  const regions = useMemo(() => getRegionOptions(entries), [entries]);

  const stats = useMemo(() => {
    const matchedFullAssets = entries.filter((entry) => entry.available).length;
    const matchedTargetAssets = entries.filter((entry) => entry.inTarget).length;
    const playableEntries = entries.filter((entry) => entry.isRunnable);
    const missingPlayable = playableEntries.filter((entry) => entry.available && !entry.inTarget).length;

    return {
      total: entries.length,
      playable: playableEntries.length,
      inSet: matchedTargetAssets,
      missingPlayable,
      selected: selectedIds.size,
      copyable: selectedPlan.items.length,
      sampleCopyable: selectedSamplePlan.items.length,
      sampleNeeded: selectedSamplePlan.required.length,
      sampleGaps: playSetSamplePlan.items.length + playSetSamplePlan.missing.length,
      missingPlaySetSamples: playSetSamplePlan.items.length,
      missingPlaySetSampleSources: playSetSamplePlan.missing.length,
      soundtrackCopyable: selectedSoundtrackPlan.items.length,
      removable: selectedRemoveItems.length,
      fullUnmatched: Math.max(0, fullAssets.size - matchedFullAssets),
      targetUnmatched: Math.max(0, targetAssets.size - matchedTargetAssets),
    };
  }, [
    entries,
    fullAssets.size,
    selectedIds.size,
    selectedPlan.items.length,
    playSetSamplePlan.items.length,
    playSetSamplePlan.missing.length,
    selectedRemoveItems.length,
    selectedSamplePlan.items.length,
    selectedSamplePlan.required.length,
    selectedSoundtrackPlan.items.length,
    targetAssets.size,
  ]);

  const filteredEntries = useMemo(() => {
    const terms = query
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);

    const filtered = entries.filter((entry) => {
      if (hideClones && entry.cloneOf) {
        return false;
      }

      if (hideSystemRoms && !entry.isRunnable) {
        return false;
      }

      if (region !== 'all' && entry.region !== region) {
        return false;
      }

      if (terms.length > 0 && !terms.every((term) => entry.searchText.includes(term))) {
        return false;
      }

      if (view === 'missing') {
        return entry.available && !entry.inTarget;
      }

      if (view === 'inSet') {
        return entry.inTarget;
      }

      if (view === 'selected') {
        return selectedIds.has(entry.id);
      }

      if (view === 'unavailable') {
        return !entry.available;
      }

      return true;
    });

    return filtered.sort((left, right) => compareEntries(left, right, sortKey));
  }, [entries, hideClones, hideSystemRoms, query, region, selectedIds, sortKey, view]);

  const canIndex = Boolean(handles.fullDir && handles.xmlFile && handles.targetDir);
  const isBusy = isIndexing || Boolean(copyProgress) || Boolean(removeProgress) || Boolean(sampleFixProgress);
  const copyWorkCount = selectedPlan.items.length + selectedSamplePlan.items.length + selectedSoundtrackPlan.items.length;
  const copySelectableCount =
    copyWorkCount ||
    (includeSamples ? selectedSamplePlan.required.length : 0) ||
    (includeSoundtracks ? selectedSoundtrackPlan.required.length : 0);

  async function syncSampleHandle(key: SourceKey, handle: FileSystemHandle) {
    if (key === 'sampleSourceDir') {
      const source = await resolveSampleDirectory(handle as FileSystemDirectoryHandle, {
        preferSamplesSubfolder: true,
      });
      setSampleSourceAssets(source.assets);
      return;
    }

    if (key === 'soundtrackSourceDir') {
      const source = await resolveSoundtrackDirectory(handle as FileSystemDirectoryHandle, {
        preferSoundtrackSubfolder: true,
      });
      setSoundtrackSourceAssets(source.assets);
      return;
    }

    if (key === 'sampleTargetDir') {
      const target = await resolveSampleDirectory(handle as FileSystemDirectoryHandle, {
        createSubfolder: true,
        preferSamplesSubfolder: true,
      });
      setSampleTargetAssets(target.assets);
      setSampleTargetDirectory(target.directory);
    }
  }

  const chooseSource = useCallback(async (key: SourceKey) => {
    try {
      setError('');
      let handle: FileSystemHandle | undefined;

      if (key === 'fullDir') {
        handle = await pickFullDirectory();
      } else if (key === 'targetDir') {
        handle = await pickTargetDirectory();
      } else if (key === 'sampleSourceDir') {
        handle = await pickSampleSourceDirectory();
      } else if (key === 'sampleTargetDir') {
        handle = await pickSampleTargetDirectory();
      } else if (key === 'soundtrackSourceDir') {
        handle = await pickSoundtrackSourceDirectory();
      } else {
        handle = await pickXmlFile();
      }

      if (!handle) {
        return;
      }

      setHandles((current) => ({ ...current, [key]: handle }));
      setSourceStatuses((current) => ({
        ...current,
        [key]: {
          detail: 'Checking selection...',
          selectedName: handle.name,
          state: 'checking',
        },
      }));

      let saveWarning = '';
      try {
        await saveHandle(key, handle);
      } catch {
        saveWarning = ' Connected for this session, but the browser did not save it for next time.';
      }

      const status = await inspectSource(key, handle);
      await syncSampleHandle(key, handle);
      setSourceStatuses((current) => ({
        ...current,
        [key]: {
          ...status,
          detail: `${status.detail}${saveWarning}`,
          state: saveWarning && status.state === 'ready' ? 'warning' : status.state,
        },
      }));
      setMessage(`${sourceLabel(key)} connected.`);
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === 'AbortError') {
        return;
      }

      const detail = getErrorMessage(caught);
      setError(detail);
      setSourceStatuses((current) => ({
        ...current,
        [key]: {
          detail,
          selectedName: current[key].selectedName,
          state: 'warning',
        },
      }));
    }
  }, []);

  const indexSources = useCallback(async (options: { auto?: boolean } = {}) => {
    if (!handles.fullDir || !handles.xmlFile || !handles.targetDir) {
      setError('Choose all three sources first.');
      return;
    }

    const fullDir = handles.fullDir;
    const xmlHandle = handles.xmlFile;
    const targetDir = handles.targetDir;

    try {
      setIsIndexing(true);
      setError('');
      setMessage(options.auto ? 'Indexing saved sources...' : 'Indexing ROM sources...');
      setLastPlan(null);

      const [fullAllowed, xmlAllowed, targetAllowed] = await Promise.all([
        verifyPermission(fullDir, 'read'),
        verifyPermission(xmlHandle, 'read'),
        verifyPermission(targetDir, 'readwrite'),
      ]);

      if (!fullAllowed || !xmlAllowed || !targetAllowed) {
        throw new Error('The browser did not receive permission for every source.');
      }

      const xmlFile = await xmlHandle.getFile();
      const [xmlText, fullSource, nextTargetAssets, sampleSource, sampleTarget, soundtrackSource] = await Promise.all([
        xmlFile.text(),
        resolveRomDirectory(fullDir, { preferRomsSubfolder: true }),
        listRomAssets(targetDir),
        resolveSampleSource(handles.sampleSourceDir, fullDir),
        resolveSampleTarget(handles.sampleTargetDir),
        resolveSoundtrackSource(handles.soundtrackSourceDir, fullDir),
      ]);
      const nextFullAssets = fullSource.assets;
      if (nextFullAssets.size === 0) {
        setSourceStatuses((current) => ({
          ...current,
          fullDir: {
            detail: 'No ROM archives found. Choose the full set folder or its roms subfolder.',
            selectedName: fullDir.name,
            state: 'warning',
          },
        }));
        throw new Error('No ROM archives were found in the full set source.');
      }

      const nextEntries = parseMameXml(xmlText);

      setParsedEntries(nextEntries);
      setFullAssets(nextFullAssets);
      setTargetAssets(nextTargetAssets);
      setSampleSourceAssets(sampleSource.assets);
      setSampleTargetAssets(sampleTarget.assets);
      setSoundtrackSourceAssets(soundtrackSource.assets);
      setSampleTargetDirectory(sampleTarget.directory);
      setSourceStatuses((current) => ({
        ...current,
        fullDir: {
          detail: formatDirectoryStatus(fullSource.assets.size, fullSource.usedSubfolder, 'full set'),
          selectedName: fullSource.selectedName,
          state: 'ready',
        },
        targetDir: {
          detail:
            nextTargetAssets.size > 0
              ? `${nextTargetAssets.size.toLocaleString()} ROM item${nextTargetAssets.size === 1 ? '' : 's'} found in the playing set.`
              : 'No ROMs found yet. This playing-set folder can still receive copied ROMs.',
          selectedName: targetDir.name,
          state: nextTargetAssets.size > 0 ? 'ready' : 'warning',
        },
        xmlFile: {
          detail: `${xmlFile.name} loaded.`,
          selectedName: xmlFile.name,
          state: 'ready',
        },
        sampleSourceDir: sampleSource.available
          ? {
              detail: formatSampleDirectoryStatus(sampleSource.assets.size, sampleSource.usedSubfolder, 'source'),
              selectedName: sampleSource.selectedName,
              state: sampleSource.assets.size > 0 ? 'ready' : 'warning',
            }
          : current.sampleSourceDir,
        sampleTargetDir: sampleTarget.available
          ? {
              detail: formatSampleDirectoryStatus(sampleTarget.assets.size, sampleTarget.usedSubfolder, 'target'),
              selectedName: sampleTarget.selectedName,
              state: 'ready',
            }
          : current.sampleTargetDir,
        soundtrackSourceDir: soundtrackSource.available
          ? {
              detail: formatSoundtrackDirectoryStatus(soundtrackSource.assets.size, soundtrackSource.usedSubfolder),
              selectedName: soundtrackSource.selectedName,
              state: soundtrackSource.assets.size > 0 ? 'ready' : 'warning',
            }
          : current.soundtrackSourceDir,
      }));
      setSelectedIds(new Set());
      setLastIndexed(new Date());
      setMessage(`${nextEntries.length.toLocaleString()} games indexed.`);
    } catch (caught) {
      const detail = getErrorMessage(caught);
      setError(
        options.auto
          ? `${detail} Your saved sources are still selected; click Scan to grant permission or retry.`
          : detail,
      );
    } finally {
      setIsIndexing(false);
    }
  }, [
    handles.fullDir,
    handles.sampleSourceDir,
    handles.sampleTargetDir,
    handles.soundtrackSourceDir,
    handles.targetDir,
    handles.xmlFile,
  ]);

  useEffect(() => {
    if (!autoScanPending || !canIndex || isBusy || lastIndexed) {
      return;
    }

    setAutoScanPending(false);
    void indexSources({ auto: true });
  }, [autoScanPending, canIndex, indexSources, isBusy, lastIndexed]);

  const copySelected = useCallback(async () => {
    if (!handles.targetDir) {
      setError('Choose a playing set folder first.');
      return;
    }

    const plan = buildCopyPlan(selectedIds, entries, targetAssets, includeDependencies);
    const possibleSamplePlan = buildSamplePlan(selectedIds, entries, sampleSourceAssets, sampleTargetAssets);
    let shouldCopySamples = includeSamples;
    if (!shouldCopySamples && possibleSamplePlan.required.length > 0) {
      shouldCopySamples = window.confirm(
        `Selected ROMs require ${possibleSamplePlan.required.length.toLocaleString()} sample pack${possibleSamplePlan.required.length === 1 ? '' : 's'}. Copy samples too?`,
      );
    }

    const samplePlan = shouldCopySamples
      ? buildSamplePlan(selectedIds, entries, sampleSourceAssets, sampleTargetAssets)
      : {
          alreadyPresent: [],
          items: [],
          missing: [],
          required: [],
        };
    const soundtrackPlan = includeSoundtracks
      ? buildSoundtrackPlan(selectedIds, entries, soundtrackSourceAssets, sampleTargetAssets)
      : {
          alreadyPresent: [],
          items: [],
          missing: [],
          required: [],
    };
    setLastPlan(plan);
    const optionalNotes: string[] = [];
    let copySamplePlan = samplePlan;
    let copySoundtrackPlan = soundtrackPlan;

    if (shouldCopySamples && samplePlan.required.length > 0) {
      if (sampleSourceAssets.size === 0) {
        optionalNotes.push('samples skipped: choose a sample source folder');
        copySamplePlan = emptySamplePlan();
      } else if (!sampleTargetDirectory) {
        optionalNotes.push('samples skipped: choose a sample target folder');
        copySamplePlan = emptySamplePlan();
      } else if (samplePlan.missing.length > 0) {
        const missing = samplePlan.missing.map((sample) => sample.sampleId).join(', ');
        optionalNotes.push(`sample pack${samplePlan.missing.length === 1 ? '' : 's'} unavailable: ${missing}`);
      }
    }

    if (soundtrackPlan.required.length > 0) {
      if (soundtrackSourceAssets.size === 0) {
        optionalNotes.push('OST skipped: choose an OST source folder');
        copySoundtrackPlan = emptySamplePlan();
      } else if (!sampleTargetDirectory) {
        optionalNotes.push('OST skipped: choose a sample target folder');
        copySoundtrackPlan = emptySamplePlan();
      } else if (soundtrackPlan.missing.length > 0) {
        const missing = soundtrackPlan.missing.map((sample) => sample.sampleId).join(', ');
        optionalNotes.push(`OST pack${soundtrackPlan.missing.length === 1 ? '' : 's'} unavailable: ${missing}`);
      }
    }

    if (plan.items.length === 0 && copySamplePlan.items.length === 0 && copySoundtrackPlan.items.length === 0) {
      setMessage(['Nothing new to copy.', ...optionalNotes].join(' '));
      return;
    }

    const targetDir = handles.targetDir;
    const samplesDir = sampleTargetDirectory;

    try {
      setError('');
      const [targetAllowed, samplesAllowed] = await Promise.all([
        verifyPermission(targetDir, 'readwrite'),
        samplesDir ? verifyPermission(samplesDir, 'readwrite') : Promise.resolve(true),
      ]);
      if (!targetAllowed) {
        throw new Error('The browser did not receive write permission for the playing set.');
      }
      if (!samplesAllowed) {
        throw new Error('The browser did not receive write permission for the sample target.');
      }

      for (let index = 0; index < plan.items.length; index += 1) {
        const item = plan.items[index];
        setCopyProgress({
          current: index + 1,
          total: plan.items.length + copySamplePlan.items.length + copySoundtrackPlan.items.length,
          label: item.asset.name,
        });
        await copyAssetToDirectory(item.asset, targetDir);
      }

      for (let index = 0; index < copySamplePlan.items.length; index += 1) {
        const item = copySamplePlan.items[index];
        setCopyProgress({
          current: plan.items.length + index + 1,
          total: plan.items.length + copySamplePlan.items.length + copySoundtrackPlan.items.length,
          label: item.asset.name,
        });
        await copyAssetToDirectory(item.asset, samplesDir!);
      }

      for (let index = 0; index < copySoundtrackPlan.items.length; index += 1) {
        const item = copySoundtrackPlan.items[index];
        setCopyProgress({
          current: plan.items.length + copySamplePlan.items.length + index + 1,
          total: plan.items.length + copySamplePlan.items.length + copySoundtrackPlan.items.length,
          label: item.asset.name,
        });
        await copyAssetToDirectory(item.asset, samplesDir!);
      }

      const [refreshedTargetAssets, refreshedSampleAssets] = await Promise.all([
        listRomAssets(targetDir),
        samplesDir ? listSampleAssets(samplesDir) : Promise.resolve(sampleTargetAssets),
      ]);
      setTargetAssets(refreshedTargetAssets);
      setSampleTargetAssets(refreshedSampleAssets);
      setSourceStatuses((current) => ({
        ...current,
        targetDir: {
          detail: `${refreshedTargetAssets.size.toLocaleString()} ROM item${refreshedTargetAssets.size === 1 ? '' : 's'} found in the playing set.`,
          selectedName: targetDir.name,
          state: 'ready',
        },
        sampleTargetDir: samplesDir
          ? {
              detail: `${refreshedSampleAssets.size.toLocaleString()} sample pack${refreshedSampleAssets.size === 1 ? '' : 's'} found in the sample target.`,
              selectedName: samplesDir.name,
              state: 'ready',
            }
          : current.sampleTargetDir,
      }));
      setSelectedIds((current) => {
        const copied = new Set([
          ...plan.items.map((item) => item.entry.id),
          ...plan.alreadyPresent.map((entry) => entry.id),
          ...copySamplePlan.items.map((item) => item.entry.id),
          ...samplePlan.alreadyPresent.map((item) => item.entry.id),
          ...copySoundtrackPlan.items.map((item) => item.entry.id),
          ...soundtrackPlan.alreadyPresent.map((item) => item.entry.id),
        ]);
        return new Set([...current].filter((id) => !copied.has(id)));
      });
      const romText = `${plan.items.length.toLocaleString()} ROM item${plan.items.length === 1 ? '' : 's'}`;
      const sampleText = `${copySamplePlan.items.length.toLocaleString()} sample pack${copySamplePlan.items.length === 1 ? '' : 's'}`;
      const soundtrackText = `${copySoundtrackPlan.items.length.toLocaleString()} OST pack${copySoundtrackPlan.items.length === 1 ? '' : 's'}`;
      setMessage([`${romText}, ${sampleText}, and ${soundtrackText} copied.`, ...optionalNotes].join(' '));
    } catch (caught) {
      setError(getErrorMessage(caught));
    } finally {
      setCopyProgress(null);
    }
  }, [
    entries,
    handles.targetDir,
    includeDependencies,
    includeSamples,
    includeSoundtracks,
    sampleSourceAssets,
    sampleTargetAssets,
    sampleTargetDirectory,
    selectedIds,
    soundtrackSourceAssets,
    targetAssets,
  ]);

  const fixPlaySetSamples = useCallback(async () => {
    if (playSetSamplePlan.required.length === 0) {
      setMessage('No sample packs are required by the current playing set.');
      return;
    }

    if (playSetSamplePlan.items.length === 0) {
      if (playSetSamplePlan.missing.length > 0) {
        const missing = playSetSamplePlan.missing.map((sample) => sample.sampleId).join(', ');
        setError(`The playing set needs sample packs that were not found in the sample source: ${missing}.`);
      } else {
        setMessage('All required playing-set sample packs are present.');
      }
      return;
    }

    if (!sampleTargetDirectory) {
      setError('Choose a sample target folder before fixing playing-set samples.');
      return;
    }

    try {
      setError('');
      const targetAllowed = await verifyPermission(sampleTargetDirectory, 'readwrite');
      if (!targetAllowed) {
        throw new Error('The browser did not receive write permission for the sample target.');
      }

      for (let index = 0; index < playSetSamplePlan.items.length; index += 1) {
        const item = playSetSamplePlan.items[index];
        setSampleFixProgress({
          current: index + 1,
          total: playSetSamplePlan.items.length,
          label: item.asset.name,
        });
        await copyAssetToDirectory(item.asset, sampleTargetDirectory);
      }

      const refreshedSampleAssets = await listSampleAssets(sampleTargetDirectory);
      setSampleTargetAssets(refreshedSampleAssets);
      setSourceStatuses((current) => ({
        ...current,
        sampleTargetDir: {
          detail: `${refreshedSampleAssets.size.toLocaleString()} sample pack${refreshedSampleAssets.size === 1 ? '' : 's'} found in the sample target.`,
          selectedName: sampleTargetDirectory.name,
          state: 'ready',
        },
      }));
      setMessage(`${playSetSamplePlan.items.length.toLocaleString()} missing playing-set sample pack${playSetSamplePlan.items.length === 1 ? '' : 's'} copied.`);
    } catch (caught) {
      setError(getErrorMessage(caught));
    } finally {
      setSampleFixProgress(null);
    }
  }, [playSetSamplePlan, sampleTargetDirectory]);

  const removeSelected = useCallback(async () => {
    if (!handles.targetDir) {
      setError('Choose a playing set folder first.');
      return;
    }

    if (selectedRemoveItems.length === 0) {
      setMessage('No selected ROMs are in the playing set.');
      return;
    }

    const confirmed = window.confirm(
      `Remove ${selectedRemoveItems.length.toLocaleString()} ROM item${selectedRemoveItems.length === 1 ? '' : 's'} from the playing set?`,
    );
    if (!confirmed) {
      return;
    }

    try {
      setError('');
      const targetAllowed = await verifyPermission(handles.targetDir, 'readwrite');
      if (!targetAllowed) {
        throw new Error('The browser did not receive write permission for the playing set.');
      }

      for (let index = 0; index < selectedRemoveItems.length; index += 1) {
        const item = selectedRemoveItems[index];
        setRemoveProgress({
          current: index + 1,
          total: selectedRemoveItems.length,
          label: item.asset.name,
        });
        await removeAssetFromDirectory(item.asset, handles.targetDir);
      }

      const refreshedTargetAssets = await listRomAssets(handles.targetDir);
      setTargetAssets(refreshedTargetAssets);
      setSourceStatuses((current) => ({
        ...current,
        targetDir: {
          detail: `${refreshedTargetAssets.size.toLocaleString()} ROM item${refreshedTargetAssets.size === 1 ? '' : 's'} found in the playing set.`,
          selectedName: handles.targetDir?.name,
          state: 'ready',
        },
      }));
      setSelectedIds((current) => {
        const removed = new Set(selectedRemoveItems.map((item) => item.entry.id));
        return new Set([...current].filter((id) => !removed.has(id)));
      });
      setMessage(`${selectedRemoveItems.length.toLocaleString()} ROM item${selectedRemoveItems.length === 1 ? '' : 's'} removed.`);
    } catch (caught) {
      setError(getErrorMessage(caught));
    } finally {
      setRemoveProgress(null);
    }
  }, [handles.targetDir, selectedRemoveItems]);

  function toggleSelected(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function selectVisibleMissing() {
    setSelectedIds((current) => {
      const next = new Set(current);
      for (const entry of filteredEntries) {
        if (entry.inTarget || (entry.available && !entry.inTarget)) {
          next.add(entry.id);
        }
      }
      return next;
    });
  }

  function clearSelected() {
    setSelectedIds(new Set());
    setLastPlan(null);
  }

  if (!supportsFileSystemAccess) {
    return (
      <main className="unsupported-shell">
        <div className="unsupported-panel">
          <CircleAlert aria-hidden="true" />
          <h1>ROM Set Manager</h1>
          <p>Chrome or Edge is required for browser folder access.</p>
        </div>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">RM</div>
          <div>
            <h1>ROM Set Manager</h1>
            <p>MAME 2003-Plus</p>
          </div>
        </div>

        <div className="topbar-actions">
          <button className="button secondary" type="button" onClick={() => indexSources()} disabled={!canIndex || isBusy}>
            {isIndexing ? <Loader2 className="spin" aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}
            <span>Scan</span>
          </button>
          <button
            className="button secondary"
            type="button"
            onClick={fixPlaySetSamples}
            disabled={playSetSamplePlan.items.length === 0 || isBusy}
            title={`${playSetSamplePlan.items.length.toLocaleString()} missing sample pack${playSetSamplePlan.items.length === 1 ? '' : 's'} can be copied; ${playSetSamplePlan.missing.length.toLocaleString()} missing from source`}
          >
            {sampleFixProgress ? <Loader2 className="spin" aria-hidden="true" /> : <PackageOpen aria-hidden="true" />}
            <span>Fix Samples {playSetSamplePlan.items.length > 0 ? playSetSamplePlan.items.length.toLocaleString() : ''}</span>
          </button>
          <button
            className="button primary"
            type="button"
            onClick={copySelected}
            disabled={copySelectableCount === 0 || isBusy}
            title={`${selectedPlan.items.length.toLocaleString()} ROM item${selectedPlan.items.length === 1 ? '' : 's'}, ${selectedSamplePlan.items.length.toLocaleString()} sample pack${selectedSamplePlan.items.length === 1 ? '' : 's'}, and ${selectedSoundtrackPlan.items.length.toLocaleString()} OST pack${selectedSoundtrackPlan.items.length === 1 ? '' : 's'} ready`}
          >
            {copyProgress ? <Loader2 className="spin" aria-hidden="true" /> : <Copy aria-hidden="true" />}
            <span>Copy {copyWorkCount > 0 ? copyWorkCount.toLocaleString() : ''}</span>
          </button>
          <button
            className="button danger"
            type="button"
            onClick={removeSelected}
            disabled={selectedRemoveItems.length === 0 || isBusy}
            title={`${selectedRemoveItems.length.toLocaleString()} item${selectedRemoveItems.length === 1 ? '' : 's'} removable`}
          >
            {removeProgress ? <Loader2 className="spin" aria-hidden="true" /> : <Trash2 aria-hidden="true" />}
            <span>Remove {selectedRemoveItems.length > 0 ? selectedRemoveItems.length.toLocaleString() : ''}</span>
          </button>
        </div>
      </header>

      <section className="source-strip" aria-label="Sources">
        {SOURCE_CONFIG.map((source) => (
          <SourceTile
            key={source.key}
            config={source}
            handle={handles[source.key]}
            status={sourceStatuses[source.key]}
            onPick={() => chooseSource(source.key)}
          />
        ))}
      </section>

      <section className="status-line" aria-live="polite">
        <div className="status-message">
          <Check aria-hidden="true" />
          <span>{message || 'Choose sources, then scan.'}</span>
        </div>
        <span>{lastIndexed ? `Indexed ${lastIndexed.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : ''}</span>
      </section>

      {error ? <InlineError message={error} onDismiss={() => setError('')} /> : null}

      <section className="metrics-grid" aria-label="Set metrics">
        <Metric label="Indexed" value={stats.total} />
        <Metric label="Playable" value={stats.playable} />
        <Metric label="In set" value={stats.inSet} tone="good" />
        <Metric label="Missing" value={stats.missingPlayable} tone="warn" />
        <Metric label="Selected" value={stats.selected} />
        <Metric label="Copyable" value={stats.copyable} tone="action" />
        <Metric label="Samples" value={stats.sampleCopyable} tone="action" />
        <Metric label="Sample gaps" value={stats.sampleGaps} tone={stats.sampleGaps > 0 ? 'warn' : 'good'} />
        <Metric label="OST" value={stats.soundtrackCopyable} tone="action" />
        <Metric label="Removable" value={stats.removable} tone="danger" />
        <Metric label="Full extras" value={stats.fullUnmatched} />
        <Metric label="Set extras" value={stats.targetUnmatched} />
      </section>

      <section className="manager-panel">
        <div className="toolbar">
          <label className="search-box">
            <Search aria-hidden="true" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search title, file, maker, year"
            />
          </label>

          <div className="segmented" aria-label="View">
            {VIEW_OPTIONS.map((option) => (
              <button
                key={option.key}
                className={view === option.key ? 'active' : ''}
                type="button"
                onClick={() => setView(option.key)}
              >
                {option.label}
              </button>
            ))}
          </div>

          <div className="toolbar-selects">
            <label>
              <span>Region</span>
              <select value={region} onChange={(event) => setRegion(event.target.value)}>
                <option value="all">All</option>
                {regions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>

            <label>
              <span>Sort</span>
              <select value={sortKey} onChange={(event) => setSortKey(event.target.value as SortKey)}>
                <option value="title">Title</option>
                <option value="region">Region</option>
                <option value="year">Year</option>
                <option value="manufacturer">Maker</option>
              </select>
            </label>
          </div>
        </div>

        <div className="option-row">
          <label className="check-option">
            <input type="checkbox" checked={includeDependencies} onChange={(event) => setIncludeDependencies(event.target.checked)} />
            <span>Copy parents</span>
          </label>
          <label className="check-option">
            <input type="checkbox" checked={includeSamples} onChange={(event) => setIncludeSamples(event.target.checked)} />
            <span>Copy samples</span>
          </label>
          <label className="check-option">
            <input type="checkbox" checked={includeSoundtracks} onChange={(event) => setIncludeSoundtracks(event.target.checked)} />
            <span>Copy OST</span>
          </label>
          <label className="check-option">
            <input type="checkbox" checked={hideClones} onChange={(event) => setHideClones(event.target.checked)} />
            <span>Hide clones</span>
          </label>
          <label className="check-option">
            <input type="checkbox" checked={hideSystemRoms} onChange={(event) => setHideSystemRoms(event.target.checked)} />
            <span>Hide BIOS</span>
          </label>

          <div className="row-actions">
            <button className="icon-button label-button" type="button" onClick={selectVisibleMissing} disabled={filteredEntries.length === 0}>
              <ListChecks aria-hidden="true" />
              <span>Select visible</span>
            </button>
            <button className="icon-button label-button" type="button" onClick={clearSelected} disabled={selectedIds.size === 0}>
              <X aria-hidden="true" />
              <span>Clear</span>
            </button>
          </div>
        </div>

        {copyProgress ? (
          <div className="copy-progress">
            <div>
              <strong>
                Copying {copyProgress.current} of {copyProgress.total}
              </strong>
              <span>{copyProgress.label}</span>
            </div>
            <progress value={copyProgress.current} max={copyProgress.total} />
          </div>
        ) : null}

        {removeProgress ? (
          <div className="remove-progress">
            <div>
              <strong>
                Removing {removeProgress.current} of {removeProgress.total}
              </strong>
              <span>{removeProgress.label}</span>
            </div>
            <progress value={removeProgress.current} max={removeProgress.total} />
          </div>
        ) : null}

        {sampleFixProgress ? (
          <div className="copy-progress">
            <div>
              <strong>
                Fixing samples {sampleFixProgress.current} of {sampleFixProgress.total}
              </strong>
              <span>{sampleFixProgress.label}</span>
            </div>
            <progress value={sampleFixProgress.current} max={sampleFixProgress.total} />
          </div>
        ) : null}

        {playSetSamplePlan.items.length > 0 || playSetSamplePlan.missing.length > 0 ? (
          <div className="plan-note">
            <PackageOpen aria-hidden="true" />
            <span>
              Playing set sample gaps: {playSetSamplePlan.items.length} fixable
              {playSetSamplePlan.missing.length > 0 ? ` - ${playSetSamplePlan.missing.length} missing from source` : ''}
            </span>
          </div>
        ) : null}

        {lastPlan && (lastPlan.missing.length > 0 || lastPlan.alreadyPresent.length > 0) ? (
          <div className="plan-note">
            <Settings2 aria-hidden="true" />
            <span>
              {lastPlan.missing.length > 0 ? `${lastPlan.missing.length} missing source` : ''}
              {lastPlan.missing.length > 0 && lastPlan.alreadyPresent.length > 0 ? ' - ' : ''}
              {lastPlan.alreadyPresent.length > 0 ? `${lastPlan.alreadyPresent.length} already present` : ''}
            </span>
          </div>
        ) : null}

        {includeSamples && selectedSamplePlan.required.length > 0 ? (
          <div className="plan-note">
            <PackageOpen aria-hidden="true" />
            <span>
              {selectedSamplePlan.items.length > 0 ? `${selectedSamplePlan.items.length} sample copyable` : ''}
              {selectedSamplePlan.items.length > 0 && selectedSamplePlan.missing.length > 0 ? ' - ' : ''}
              {selectedSamplePlan.missing.length > 0 ? `${selectedSamplePlan.missing.length} missing sample source` : ''}
              {selectedSamplePlan.items.length === 0 && selectedSamplePlan.missing.length === 0
                ? `${selectedSamplePlan.alreadyPresent.length} sample already present`
                : ''}
            </span>
          </div>
        ) : null}

        {includeSoundtracks && selectedSoundtrackPlan.required.length > 0 ? (
          <div className="plan-note">
            <PackageOpen aria-hidden="true" />
            <span>
              {selectedSoundtrackPlan.items.length > 0 ? `${selectedSoundtrackPlan.items.length} OST copyable` : ''}
              {selectedSoundtrackPlan.items.length > 0 && selectedSoundtrackPlan.missing.length > 0 ? ' - ' : ''}
              {selectedSoundtrackPlan.missing.length > 0 ? `${selectedSoundtrackPlan.missing.length} missing OST source` : ''}
              {selectedSoundtrackPlan.items.length === 0 && selectedSoundtrackPlan.missing.length === 0
                ? `${selectedSoundtrackPlan.alreadyPresent.length} OST already present`
                : ''}
            </span>
          </div>
        ) : null}

        <RomTable entries={filteredEntries} selectedIds={selectedIds} onToggle={toggleSelected} />
      </section>
    </main>
  );
}

function InlineError({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div className="inline-error" role="alert">
      <CircleAlert aria-hidden="true" />
      <span>{message}</span>
      <button type="button" onClick={onDismiss} aria-label="Dismiss error">
        <X aria-hidden="true" />
      </button>
    </div>
  );
}

function SourceTile({
  config,
  handle,
  status,
  onPick,
}: {
  config: (typeof SOURCE_CONFIG)[number];
  handle: FileSystemHandle | null;
  status: SourceStatus;
  onPick: () => void;
}) {
  const Icon = config.icon;
  const isReady = status.state === 'ready';
  const isChecking = status.state === 'checking';
  const handleName = status.selectedName || handle?.name || '';
  const displayLabel = config.suggestedPath;

  return (
    <article className={`source-tile source-${status.state}`}>
      <div className="source-icon">
        <Icon aria-hidden="true" />
      </div>
      <div className="source-copy">
        <div className="source-heading">
          <span>{config.label}</span>
          {isChecking ? (
            <Loader2 className="spin" aria-label="Checking" />
          ) : isReady ? (
            <CheckCheck aria-label="Ready" />
          ) : (
            <CircleAlert aria-label={handle ? 'Needs attention' : 'Not connected'} />
          )}
        </div>
        <p>{status.detail}</p>
        <code title={displayLabel}>Label: {displayLabel}</code>
        {handleName ? <code title={handleName}>Handle: {handleName}</code> : null}
      </div>
      <div className="source-actions">
        <button className="icon-button" type="button" onClick={onPick} title={`Choose ${config.label}`} aria-label={`Choose ${config.label}`}>
          <FolderOpen aria-hidden="true" />
        </button>
      </div>
    </article>
  );
}

function Metric({ label, value, tone = 'neutral' }: { label: string; value: number; tone?: 'neutral' | 'good' | 'warn' | 'action' | 'danger' }) {
  return (
    <div className={`metric metric-${tone}`}>
      <span>{label}</span>
      <strong>{value.toLocaleString()}</strong>
    </div>
  );
}

function RomTable({
  entries,
  selectedIds,
  onToggle,
}: {
  entries: RomEntry[];
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
}) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th className="select-col">Pick</th>
            <th className="status-col">Set</th>
            <th>Name</th>
            <th className="rom-col">ROM</th>
            <th className="region-col">Region</th>
            <th className="players-col">Players</th>
            <th className="year-col">Year</th>
            <th className="maker-col">Maker</th>
            <th className="stats-col">Stats</th>
            <th className="media-col">Media</th>
          </tr>
        </thead>
        <tbody>
          {entries.length === 0 ? (
            <tr>
              <td colSpan={10} className="empty-cell">
                No ROMs match the current view.
              </td>
            </tr>
          ) : (
            entries.map((entry) => (
              <RomRow key={entry.id} entry={entry} checked={selectedIds.has(entry.id)} onToggle={() => onToggle(entry.id)} />
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function RomRow({ entry, checked, onToggle }: { entry: RomEntry; checked: boolean; onToggle: () => void }) {
  const status = entry.inTarget ? 'In set' : entry.available ? 'Missing' : 'No source';
  const statusClass = entry.inTarget ? 'status-in' : entry.available ? 'status-missing' : 'status-none';
  const details = [
    entry.cloneOf ? `clone: ${entry.cloneOf}${entry.parentTitle ? ` (${entry.parentTitle})` : ''}` : '',
    entry.genre || entry.category,
    entry.driverStatus,
    entry.driverName ? `driver: ${entry.driverName}` : '',
    entry.sampleArchiveIds.length > 0 ? `samples: ${entry.sampleArchiveIds.join(', ')}` : '',
    entry.display,
  ].filter(Boolean);

  return (
    <tr className={checked ? 'selected-row' : ''}>
      <td className="select-col">
        <input
          type="checkbox"
          checked={checked}
          onChange={onToggle}
          disabled={!entry.inTarget && !entry.available}
          aria-label={`Select ${entry.title}`}
        />
      </td>
      <td className="status-col">
        <span className={`status-pill ${statusClass}`}>{status}</span>
      </td>
      <td>
        <div className="game-title">{entry.title}</div>
        <div className="game-detail">{details.join(' | ') || 'Arcade'}</div>
      </td>
      <td className="rom-col">
        <code className="rom-code">{entry.fullAssetName || `${entry.id}.zip`}</code>
        {entry.targetAssetName && <div className="game-detail">{entry.targetAssetName}</div>}
      </td>
      <td className="region-col">{entry.region}</td>
      <td className="players-col">{entry.players || '-'}</td>
      <td className="year-col">{entry.year || '-'}</td>
      <td className="maker-col">{entry.manufacturer || '-'}</td>
      <td className="stats-col">
        <div className="compact-stat">{entry.romCount ? `${entry.romCount} files` : '-'}</div>
        <div className="game-detail">{formatBytes(entry.romSize)}</div>
      </td>
      <td className="media-col">
        <a className="icon-button table-link" href={getScreenscraperUrl(entry)} target="_blank" rel="noreferrer" title="Open ScreenScraper">
          <ExternalLink aria-hidden="true" />
        </a>
      </td>
    </tr>
  );
}

function compareEntries(left: RomEntry, right: RomEntry, sortKey: SortKey) {
  if (sortKey === 'year') {
    return (left.year || '9999').localeCompare(right.year || '9999') || left.title.localeCompare(right.title);
  }

  return left[sortKey].localeCompare(right[sortKey]) || left.title.localeCompare(right.title);
}

function sourceLabel(key: SourceKey) {
  return SOURCE_CONFIG.find((source) => source.key === key)?.label || 'Source';
}

async function inspectSource(key: SourceKey, handle: FileSystemHandle): Promise<SourceStatus> {
  if (key === 'xmlFile') {
    const allowed = await verifyPermission(handle, 'read');
    if (!allowed) {
      return {
        detail: 'The browser did not grant read permission for this XML file.',
        selectedName: handle.name,
        state: 'warning',
      };
    }

    const file = await (handle as FileSystemFileHandle).getFile();
    return {
      detail: file.name.toLowerCase().endsWith('.xml') ? `${file.name} selected.` : 'Selected file is not an XML file.',
      selectedName: file.name,
      state: file.name.toLowerCase().endsWith('.xml') ? 'ready' : 'warning',
    };
  }

  const mode: FileSystemPermissionMode = key === 'targetDir' || key === 'sampleTargetDir' ? 'readwrite' : 'read';
  const allowed = await verifyPermission(handle, mode);
  if (!allowed) {
    return {
      detail: `The browser did not grant ${mode} permission for this folder.`,
      selectedName: handle.name,
      state: 'warning',
    };
  }

  if (key === 'fullDir') {
    const source = await resolveRomDirectory(handle as FileSystemDirectoryHandle, { preferRomsSubfolder: true });
    return {
      detail:
        source.assets.size > 0
          ? formatDirectoryStatus(source.assets.size, source.usedSubfolder, 'full set')
          : 'No ROM archives found. Choose the full set folder or its roms subfolder.',
      selectedName: source.selectedName,
      state: source.assets.size > 0 ? 'ready' : 'warning',
    };
  }

  if (key === 'sampleSourceDir') {
    const source = await resolveSampleDirectory(handle as FileSystemDirectoryHandle, {
      preferSamplesSubfolder: true,
    });
    return {
      detail: formatSampleDirectoryStatus(source.assets.size, source.usedSubfolder, 'source'),
      selectedName: source.selectedName,
      state: source.assets.size > 0 ? 'ready' : 'warning',
    };
  }

  if (key === 'sampleTargetDir') {
    const target = await resolveSampleDirectory(handle as FileSystemDirectoryHandle, {
      createSubfolder: true,
      preferSamplesSubfolder: true,
    });
    return {
      detail: formatSampleDirectoryStatus(target.assets.size, target.usedSubfolder, 'target'),
      selectedName: target.selectedName,
      state: 'ready',
    };
  }

  if (key === 'soundtrackSourceDir') {
    const source = await resolveSoundtrackDirectory(handle as FileSystemDirectoryHandle, {
      preferSoundtrackSubfolder: true,
    });
    return {
      detail: formatSoundtrackDirectoryStatus(source.assets.size, source.usedSubfolder),
      selectedName: source.selectedName,
      state: source.assets.size > 0 ? 'ready' : 'warning',
    };
  }

  const assets = await listRomAssets(handle as FileSystemDirectoryHandle);
  return {
    detail:
      assets.size > 0
        ? `${assets.size.toLocaleString()} ROM item${assets.size === 1 ? '' : 's'} found in the playing set.`
        : 'No ROMs found yet. This playing-set folder can still receive copied ROMs.',
    selectedName: handle.name,
    state: assets.size > 0 ? 'ready' : 'warning',
  };
}

function formatDirectoryStatus(count: number, usedSubfolder: boolean, label: string) {
  const countText = `${count.toLocaleString()} ROM item${count === 1 ? '' : 's'} found`;
  return usedSubfolder ? `${countText} in the roms subfolder.` : `${countText} in the selected ${label} folder.`;
}

async function resolveSampleSource(
  selectedSampleSource: FileSystemDirectoryHandle | null,
  fullSetDirectory: FileSystemDirectoryHandle,
) {
  const source = selectedSampleSource
    ? await resolveSampleDirectory(selectedSampleSource, { preferSamplesSubfolder: true })
    : await resolveSampleDirectory(fullSetDirectory, {
        onlySamplesSubfolder: fullSetDirectory.name.toLowerCase() !== 'samples',
        preferSamplesSubfolder: true,
      });

  return {
    ...source,
    available: source.assets.size > 0,
  };
}

async function resolveSampleTarget(selectedSampleTarget: FileSystemDirectoryHandle | null) {
  if (!selectedSampleTarget) {
    return {
      assets: new Map<string, RomAsset>(),
      available: false,
      directory: null,
      effectiveName: '',
      selectedName: '',
      usedSubfolder: false,
    };
  }

  const target = await resolveSampleDirectory(selectedSampleTarget, {
    createSubfolder: true,
    preferSamplesSubfolder: true,
  });

  return {
    ...target,
    available: true,
  };
}

async function resolveSoundtrackSource(
  selectedSoundtrackSource: FileSystemDirectoryHandle | null,
  fullSetDirectory: FileSystemDirectoryHandle,
) {
  const source = selectedSoundtrackSource
    ? await resolveSoundtrackDirectory(selectedSoundtrackSource, { preferSoundtrackSubfolder: true })
    : await resolveSoundtrackDirectory(fullSetDirectory, {
        onlySoundtrackSubfolder: fullSetDirectory.name.toLowerCase() !== 'optional soundtrack samples',
        preferSoundtrackSubfolder: true,
      });

  return {
    ...source,
    available: source.assets.size > 0,
  };
}

function formatSampleDirectoryStatus(count: number, usedSubfolder: boolean, label: 'source' | 'target') {
  const countText = `${count.toLocaleString()} sample pack${count === 1 ? '' : 's'} found`;
  if (label === 'target' && usedSubfolder) {
    return `${countText} in the samples subfolder.`;
  }

  if (label === 'source' && usedSubfolder) {
    return `${countText} in the samples subfolder.`;
  }

  return `${countText} in the selected sample ${label}.`;
}

function formatSoundtrackDirectoryStatus(count: number, usedSubfolder: boolean) {
  const countText = `${count.toLocaleString()} OST pack${count === 1 ? '' : 's'} found`;
  return usedSubfolder ? `${countText} in the optional soundtrack samples subfolder.` : `${countText} in the selected OST source.`;
}

function emptySamplePlan(): SamplePlan {
  return {
    alreadyPresent: [],
    items: [],
    missing: [],
    required: [],
  };
}

function getErrorMessage(caught: unknown) {
  if (caught instanceof Error) {
    return caught.message;
  }

  return 'Something went wrong.';
}
