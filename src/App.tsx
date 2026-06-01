import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeftRight,
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
} from "lucide-react";
import {
  copyAssetToDirectory,
  listSampleAssets,
  listRomAssets,
  loadHandles,
  pickFbneoFullDirectory,
  pickFbneoSampleTargetDirectory,
  pickFbneoTargetDirectory,
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
  resolveXmlFile,
  saveHandle,
  supportsFileSystemAccess,
  verifyPermission,
} from "./lib/fileSystem";
import { formatBytes, parseRomXml } from "./lib/mameParser";
import {
  buildAssetBackedEntries,
  buildCopyPlan,
  buildCounterpartPlan,
  buildMatchingSamplePlan,
  buildSamplePlan,
  buildSoundtrackPlan,
  enrichRomEntries,
  getRegionOptions,
  getScreenscraperUrl,
} from "./lib/romData";
import type {
  CopyPlan,
  CounterpartPlanItem,
  ParsedRom,
  RomAsset,
  RomEntry,
  SamplePlan,
  SourceHandles,
  SourceKey,
} from "./lib/types";

type ViewFilter =
  | "missing"
  | "inSet"
  | "shared"
  | "counterpart"
  | "all"
  | "selected"
  | "unavailable";
type SortKey = "title" | "region" | "year" | "manufacturer";
type ManagedSetKey = "mame" | "mame287" | "fbneo";

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
  state: "empty" | "checking" | "ready" | "warning";
  selectedName?: string;
};

const SET_OPTIONS: Array<{
  key: ManagedSetKey;
  label: string;
  shortLabel: string;
}> = [
  { key: "mame", label: "MAME 2003-Plus", shortLabel: "MAME" },
  { key: "mame287", label: "MAME 0.287", shortLabel: "MAME 0.287" },
  { key: "fbneo", label: "FBNeo", shortLabel: "FBNeo" },
];

const SEARCH_DEBOUNCE_MS = 250;

const EMPTY_HANDLES: SourceHandles = {
  fbneoFullDir: null,
  fbneoSampleTargetDir: null,
  fbneoTargetDir: null,
  fullDir: null,
  mame287FullDir: null,
  mame287SampleSourceDir: null,
  mame287SampleTargetDir: null,
  mame287TargetDir: null,
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
  sets: ManagedSetKey[];
}> = [
  {
    key: "fullDir",
    label: "Full set",
    detail: "Source ROMs",
    suggestedPath: "D:\\Downloads\\mame2003-plus",
    icon: Database,
    sets: ["mame"],
  },
  {
    key: "mame287FullDir",
    label: "Full set",
    detail: "Source ROMs",
    suggestedPath: "D:\\Downloads\\mame 0.287 full rom set non-merged",
    icon: Database,
    sets: ["mame287"],
  },
  {
    key: "mame287TargetDir",
    label: "Playing set",
    detail: "Managed ROMs",
    suggestedPath: "\\\\PACMAN\\share\\roms\\mame",
    icon: FolderOpen,
    sets: ["mame287"],
  },
  {
    key: "mame287SampleSourceDir",
    label: "Sample source",
    detail: "Optional audio samples",
    suggestedPath: "D:\\Downloads\\mame-samples",
    icon: PackageOpen,
    sets: ["mame287"],
  },
  {
    key: "mame287SampleTargetDir",
    label: "Sample target",
    detail: "Optional device sample destination",
    suggestedPath: "\\\\PACMAN\\share\\bios\\mame\\samples",
    icon: PackageOpen,
    sets: ["mame287"],
  },
  {
    key: "fbneoFullDir",
    label: "FBNeo set",
    detail: "Counterpart source ROMs",
    suggestedPath: "D:\\Downloads\\fbneo-1.0.0.3-full-non-merged",
    icon: Database,
    sets: ["fbneo"],
  },
  {
    key: "fbneoTargetDir",
    label: "FBNeo play set",
    detail: "Counterpart managed ROMs",
    suggestedPath: "\\\\PACMAN\\share\\roms\\fbneo",
    icon: FolderOpen,
    sets: ["fbneo"],
  },
  {
    key: "fbneoSampleTargetDir",
    label: "FBNeo samples",
    detail: "Sample destination",
    suggestedPath: "\\\\PACMAN\\share\\bios\\fbneo\\samples",
    icon: PackageOpen,
    sets: ["fbneo"],
  },
  {
    key: "xmlFile",
    label: "MAME XML",
    detail: "Required game metadata",
    suggestedPath:
      "D:\\Downloads\\mame2003-plus\\MAME 2003-Plus - 2018-12-31.xml",
    icon: FileCode2,
    sets: ["mame"],
  },
  {
    key: "targetDir",
    label: "Playing set",
    detail: "Managed ROMs",
    suggestedPath: "\\\\PACMAN\\share\\roms\\mame\\mame2003plus",
    icon: FolderOpen,
    sets: ["mame"],
  },
  {
    key: "sampleSourceDir",
    label: "Sample source",
    detail: "Optional audio samples",
    suggestedPath: "D:\\Downloads\\mame-samples",
    icon: PackageOpen,
    sets: ["mame"],
  },
  {
    key: "sampleTargetDir",
    label: "Sample target",
    detail: "Optional device sample destination",
    suggestedPath: "\\\\PACMAN\\share\\bios\\mame\\samples",
    icon: PackageOpen,
    sets: ["mame"],
  },
  {
    key: "soundtrackSourceDir",
    label: "OST source",
    detail: "Optional soundtrack samples",
    suggestedPath: "D:\\Downloads\\mame2003-plus\\optional soundtrack samples",
    icon: PackageOpen,
    sets: ["mame"],
  },
];

const VIEW_OPTIONS: Array<{ key: ViewFilter; label: string }> = [
  { key: "missing", label: "Missing" },
  { key: "inSet", label: "In set" },
  { key: "shared", label: "Shared" },
  { key: "counterpart", label: "Counterpart" },
  { key: "selected", label: "Selected" },
  { key: "unavailable", label: "No source" },
  { key: "all", label: "All" },
];

const EMPTY_SOURCE_STATUS: Record<SourceKey, SourceStatus> = {
  fbneoFullDir: {
    detail:
      "Choose the FBNeo full set folder, its set folder, or its games folder.",
    state: "empty",
  },
  fbneoTargetDir: {
    detail: "Choose the FBNeo playing-set folder.",
    state: "empty",
  },
  fbneoSampleTargetDir: {
    detail:
      "Choose the FBNeo sample destination, usually bios\\fbneo\\samples.",
    state: "empty",
  },
  mame287FullDir: {
    detail:
      "Choose the MAME 0.287 full set folder. XML is auto-detected from this folder.",
    state: "empty",
  },
  mame287TargetDir: {
    detail: "Choose the MAME 0.287 playing-set folder.",
    state: "empty",
  },
  mame287SampleSourceDir: {
    detail: "Choose the MAME 0.287 samples source folder.",
    state: "empty",
  },
  mame287SampleTargetDir: {
    detail: "Choose where this device expects MAME 0.287 samples.",
    state: "empty",
  },
  fullDir: {
    detail:
      "Choose the MAME 2003-Plus full set folder. XML is auto-detected from this folder.",
    state: "empty",
  },
  xmlFile: {
    detail:
      "Optional. The app auto-detects XML in the full set folder when possible.",
    state: "empty",
  },
  targetDir: {
    detail: "Choose the mame2003plus playing-set folder.",
    state: "empty",
  },
  sampleSourceDir: {
    detail: "Choose the MAME samples source folder.",
    state: "empty",
  },
  sampleTargetDir: {
    detail: "Choose where this device expects MAME samples.",
    state: "empty",
  },
  soundtrackSourceDir: {
    detail:
      "Auto-detected from the full set when possible, or choose the optional soundtrack samples folder.",
    state: "empty",
  },
};

export function App() {
  const [activeSet, setActiveSet] = useState<ManagedSetKey>("mame");
  const [handles, setHandles] = useState<SourceHandles>(EMPTY_HANDLES);
  const [mameEntries, setMameEntries] = useState<ParsedRom[]>([]);
  const [mame287Entries, setMame287Entries] = useState<ParsedRom[]>([]);
  const [fbneoEntries, setFbneoEntries] = useState<ParsedRom[]>([]);
  const [fbneoAssets, setFbneoAssets] = useState<Map<string, RomAsset>>(
    new Map(),
  );
  const [fbneoSampleSourceAssets, setFbneoSampleSourceAssets] = useState<
    Map<string, RomAsset>
  >(new Map());
  const [fbneoSampleTargetAssets, setFbneoSampleTargetAssets] = useState<
    Map<string, RomAsset>
  >(new Map());
  const [fbneoTargetAssets, setFbneoTargetAssets] = useState<
    Map<string, RomAsset>
  >(new Map());
  const [fullAssets, setFullAssets] = useState<Map<string, RomAsset>>(
    new Map(),
  );
  const [mame287Assets, setMame287Assets] = useState<Map<string, RomAsset>>(
    new Map(),
  );
  const [mame287SampleSourceAssets, setMame287SampleSourceAssets] = useState<
    Map<string, RomAsset>
  >(new Map());
  const [mame287SampleTargetAssets, setMame287SampleTargetAssets] = useState<
    Map<string, RomAsset>
  >(new Map());
  const [mame287TargetAssets, setMame287TargetAssets] = useState<
    Map<string, RomAsset>
  >(new Map());
  const [targetAssets, setTargetAssets] = useState<Map<string, RomAsset>>(
    new Map(),
  );
  const [sampleSourceAssets, setSampleSourceAssets] = useState<
    Map<string, RomAsset>
  >(new Map());
  const [sampleTargetAssets, setSampleTargetAssets] = useState<
    Map<string, RomAsset>
  >(new Map());
  const [soundtrackSourceAssets, setSoundtrackSourceAssets] = useState<
    Map<string, RomAsset>
  >(new Map());
  const [fbneoSampleTargetDirectory, setFbneoSampleTargetDirectory] =
    useState<FileSystemDirectoryHandle | null>(null);
  const [mame287SampleTargetDirectory, setMame287SampleTargetDirectory] =
    useState<FileSystemDirectoryHandle | null>(null);
  const [sampleTargetDirectory, setSampleTargetDirectory] =
    useState<FileSystemDirectoryHandle | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [view, setView] = useState<ViewFilter>("missing");
  const [region, setRegion] = useState("all");
  const [sortKey, setSortKey] = useState<SortKey>("title");
  const [hideClones, setHideClones] = useState(false);
  const [hideSystemRoms, setHideSystemRoms] = useState(true);
  const [includeDependencies, setIncludeDependencies] = useState(false);
  const [includeSamples, setIncludeSamples] = useState(true);
  const [includeSoundtracks, setIncludeSoundtracks] = useState(false);
  const [
    removeOriginalAfterCounterpartCopy,
    setRemoveOriginalAfterCounterpartCopy,
  ] = useState(false);
  const [isIndexing, setIsIndexing] = useState(false);
  const [counterpartProgress, setCounterpartProgress] =
    useState<CopyProgress | null>(null);
  const [copyProgress, setCopyProgress] = useState<CopyProgress | null>(null);
  const [removeProgress, setRemoveProgress] = useState<CopyProgress | null>(
    null,
  );
  const [sampleFixProgress, setSampleFixProgress] =
    useState<CopyProgress | null>(null);
  const [lastPlan, setLastPlan] = useState<CopyPlan | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [sourceStatuses, setSourceStatuses] =
    useState<Record<SourceKey, SourceStatus>>(EMPTY_SOURCE_STATUS);
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
                detail:
                  "Saved folder restored. Scan may ask for permission again.",
                selectedName: storedHandles.fullDir.name,
                state: "ready",
              }
            : current.fullDir,
          fbneoFullDir: storedHandles.fbneoFullDir
            ? {
                detail:
                  "Saved FBNeo source restored. Scan may ask for permission again.",
                selectedName: storedHandles.fbneoFullDir.name,
                state: "ready",
              }
            : current.fbneoFullDir,
          fbneoTargetDir: storedHandles.fbneoTargetDir
            ? {
                detail:
                  "Saved FBNeo playing set restored. Scan may ask for permission again.",
                selectedName: storedHandles.fbneoTargetDir.name,
                state: "ready",
              }
            : current.fbneoTargetDir,
          fbneoSampleTargetDir: storedHandles.fbneoSampleTargetDir
            ? {
                detail:
                  "Saved FBNeo sample target restored. Scan may ask for permission again.",
                selectedName: storedHandles.fbneoSampleTargetDir.name,
                state: "ready",
              }
            : current.fbneoSampleTargetDir,
          mame287FullDir: storedHandles.mame287FullDir
            ? {
                detail:
                  "Saved MAME 0.287 source restored. Scan may ask for permission again.",
                selectedName: storedHandles.mame287FullDir.name,
                state: "ready",
              }
            : current.mame287FullDir,
          mame287TargetDir: storedHandles.mame287TargetDir
            ? {
                detail:
                  "Saved MAME 0.287 playing set restored. Scan may ask for permission again.",
                selectedName: storedHandles.mame287TargetDir.name,
                state: "ready",
              }
            : current.mame287TargetDir,
          mame287SampleSourceDir: storedHandles.mame287SampleSourceDir
            ? {
                detail:
                  "Saved MAME 0.287 sample source restored. Scan may ask for permission again.",
                selectedName: storedHandles.mame287SampleSourceDir.name,
                state: "ready",
              }
            : current.mame287SampleSourceDir,
          mame287SampleTargetDir: storedHandles.mame287SampleTargetDir
            ? {
                detail:
                  "Saved MAME 0.287 sample target restored. Scan may ask for permission again.",
                selectedName: storedHandles.mame287SampleTargetDir.name,
                state: "ready",
              }
            : current.mame287SampleTargetDir,
          xmlFile: storedHandles.xmlFile
            ? {
                detail:
                  "Saved XML restored. Scan may ask for permission again.",
                selectedName: storedHandles.xmlFile.name,
                state: "ready",
              }
            : current.xmlFile,
          targetDir: storedHandles.targetDir
            ? {
                detail:
                  "Saved playing-set folder restored. Scan may ask for permission again.",
                selectedName: storedHandles.targetDir.name,
                state: "ready",
              }
            : current.targetDir,
          sampleSourceDir: storedHandles.sampleSourceDir
            ? {
                detail:
                  "Saved sample source restored. Scan may ask for permission again.",
                selectedName: storedHandles.sampleSourceDir.name,
                state: "ready",
              }
            : current.sampleSourceDir,
          sampleTargetDir: storedHandles.sampleTargetDir
            ? {
                detail:
                  "Saved sample target restored. Scan may ask for permission again.",
                selectedName: storedHandles.sampleTargetDir.name,
                state: "ready",
              }
            : current.sampleTargetDir,
          soundtrackSourceDir: storedHandles.soundtrackSourceDir
            ? {
                detail:
                  "Saved OST source restored. Scan may ask for permission again.",
                selectedName: storedHandles.soundtrackSourceDir.name,
                state: "ready",
              }
            : current.soundtrackSourceDir,
        }));
        const hasAnyStoredHandle = Object.values(storedHandles).some(Boolean);
        const hasAllMameHandles = Boolean(
          storedHandles.fullDir && storedHandles.targetDir,
        );
        const hasAllMame287Handles = Boolean(
          storedHandles.mame287FullDir && storedHandles.mame287TargetDir,
        );
        const hasAllFbneoHandles = Boolean(
          storedHandles.fbneoFullDir && storedHandles.fbneoTargetDir,
        );
        if (!hasAllMameHandles && hasAllMame287Handles) {
          setActiveSet("mame287");
        } else if (
          !hasAllMameHandles &&
          !hasAllMame287Handles &&
          hasAllFbneoHandles
        ) {
          setActiveSet("fbneo");
        }
        if (hasAllMameHandles || hasAllMame287Handles || hasAllFbneoHandles) {
          setMessage("Saved sources restored. Click Scan to grant access.");
        } else if (hasAnyStoredHandle) {
          setMessage("Saved sources restored.");
        }
      })
      .catch(() => {
        setMessage("");
      });

    return () => {
      isActive = false;
    };
  }, []);

  const activeSetOption =
    SET_OPTIONS.find((option) => option.key === activeSet) ?? SET_OPTIONS[0];
  const counterpartSetOption =
    activeSet === "fbneo" ? SET_OPTIONS[0] : SET_OPTIONS[2];
  const activeIsFbneo = activeSet === "fbneo";
  const activeIsMame287 = activeSet === "mame287";
  const activeParsedEntries = useMemo(
    () =>
      activeSet === "mame"
        ? buildAssetBackedEntries(
            fullAssets,
            targetAssets,
            mameEntries,
            fbneoEntries,
          )
        : activeSet === "mame287"
          ? buildAssetBackedEntries(
              mame287Assets,
              mame287TargetAssets,
              mame287Entries,
              [...mameEntries, ...fbneoEntries],
            )
          : buildAssetBackedEntries(
              fbneoAssets,
              fbneoTargetAssets,
              fbneoEntries,
              [...mameEntries, ...mame287Entries],
            ),
    [
      activeSet,
      fbneoAssets,
      fbneoEntries,
      fbneoTargetAssets,
      fullAssets,
      mame287Assets,
      mame287Entries,
      mame287TargetAssets,
      mameEntries,
      targetAssets,
    ],
  );
  const activeFullAssets =
    activeSet === "mame"
      ? fullAssets
      : activeIsMame287
        ? mame287Assets
        : fbneoAssets;
  const activeTargetAssets =
    activeSet === "mame"
      ? targetAssets
      : activeIsMame287
        ? mame287TargetAssets
        : fbneoTargetAssets;
  const counterpartFullAssets = activeIsFbneo ? fullAssets : fbneoAssets;
  const counterpartTargetAssets = activeIsFbneo
    ? targetAssets
    : fbneoTargetAssets;
  const activeTargetDir =
    activeSet === "mame"
      ? handles.targetDir
      : activeIsMame287
        ? handles.mame287TargetDir
        : handles.fbneoTargetDir;
  const counterpartTargetDir = activeIsFbneo
    ? handles.targetDir
    : handles.fbneoTargetDir;
  const activeTargetSourceKey: SourceKey =
    activeSet === "mame"
      ? "targetDir"
      : activeIsMame287
        ? "mame287TargetDir"
        : "fbneoTargetDir";
  const counterpartTargetSourceKey: SourceKey = activeIsFbneo
    ? "targetDir"
    : "fbneoTargetDir";
  const activeSampleSourceAssets =
    activeSet === "mame"
      ? sampleSourceAssets
      : activeIsMame287
        ? mame287SampleSourceAssets
        : fbneoSampleSourceAssets;
  const activeSampleTargetAssets =
    activeSet === "mame"
      ? sampleTargetAssets
      : activeIsMame287
        ? mame287SampleTargetAssets
        : fbneoSampleTargetAssets;
  const activeSampleTargetDirectory =
    activeSet === "mame"
      ? sampleTargetDirectory
      : activeIsMame287
        ? mame287SampleTargetDirectory
        : fbneoSampleTargetDirectory;
  const activeSampleTargetSourceKey: SourceKey =
    activeSet === "mame"
      ? "sampleTargetDir"
      : activeIsMame287
        ? "mame287SampleTargetDir"
        : "fbneoSampleTargetDir";

  const entries = useMemo(
    () =>
      enrichRomEntries(
        activeParsedEntries,
        activeFullAssets,
        activeTargetAssets,
        counterpartFullAssets,
        counterpartTargetAssets,
      ),
    [
      activeFullAssets,
      activeParsedEntries,
      activeTargetAssets,
      counterpartFullAssets,
      counterpartTargetAssets,
    ],
  );

  const selectedPlan = useMemo(
    () =>
      buildCopyPlan(
        selectedIds,
        entries,
        activeTargetAssets,
        includeDependencies,
      ),
    [activeTargetAssets, entries, includeDependencies, selectedIds],
  );

  const selectedSamplePlan = useMemo<SamplePlan>(
    () =>
      includeSamples
        ? activeSet === "mame"
          ? buildSamplePlan(
              selectedIds,
              entries,
              sampleSourceAssets,
              sampleTargetAssets,
            )
          : activeIsMame287
            ? buildSamplePlan(
                selectedIds,
                entries,
                mame287SampleSourceAssets,
                mame287SampleTargetAssets,
              )
            : buildMatchingSamplePlan(
                selectedIds,
                entries,
                fbneoSampleSourceAssets,
                fbneoSampleTargetAssets,
              )
        : {
            alreadyPresent: [],
            items: [],
            missing: [],
            required: [],
          },
    [
      activeIsMame287,
      activeSet,
      entries,
      fbneoSampleSourceAssets,
      fbneoSampleTargetAssets,
      includeSamples,
      mame287SampleSourceAssets,
      mame287SampleTargetAssets,
      sampleSourceAssets,
      sampleTargetAssets,
      selectedIds,
    ],
  );

  const selectedSoundtrackPlan = useMemo<SamplePlan>(
    () =>
      activeSet === "mame" && includeSoundtracks
        ? buildSoundtrackPlan(
            selectedIds,
            entries,
            soundtrackSourceAssets,
            sampleTargetAssets,
          )
        : {
            alreadyPresent: [],
            items: [],
            missing: [],
            required: [],
          },
    [
      activeSet,
      entries,
      includeSoundtracks,
      sampleTargetAssets,
      selectedIds,
      soundtrackSourceAssets,
    ],
  );

  const selectedCounterpartPlan = useMemo(
    () =>
      buildCounterpartPlan(
        selectedIds,
        entries,
        activeTargetDir,
        counterpartTargetDir,
        removeOriginalAfterCounterpartCopy,
      ),
    [
      activeTargetDir,
      counterpartTargetDir,
      entries,
      removeOriginalAfterCounterpartCopy,
      selectedIds,
    ],
  );

  const playSetSamplePlan = useMemo<SamplePlan>(
    () =>
      activeSet === "mame"
        ? buildSamplePlan(
            entries.filter((entry) => entry.inTarget).map((entry) => entry.id),
            entries,
            sampleSourceAssets,
            sampleTargetAssets,
          )
        : activeIsMame287
          ? buildSamplePlan(
              entries
                .filter((entry) => entry.inTarget)
                .map((entry) => entry.id),
              entries,
              mame287SampleSourceAssets,
              mame287SampleTargetAssets,
            )
          : buildMatchingSamplePlan(
              entries
                .filter((entry) => entry.inTarget)
                .map((entry) => entry.id),
              entries,
              fbneoSampleSourceAssets,
              fbneoSampleTargetAssets,
            ),
    [
      activeIsMame287,
      activeSet,
      entries,
      fbneoSampleSourceAssets,
      fbneoSampleTargetAssets,
      mame287SampleSourceAssets,
      mame287SampleTargetAssets,
      sampleSourceAssets,
      sampleTargetAssets,
    ],
  );

  const visibleSources = useMemo(() => {
    return SOURCE_CONFIG.filter((source) => {
      if (!source.sets.includes(activeSet)) {
        return false;
      }

      if (
        activeSet === "mame" &&
        (source.key === "sampleSourceDir" || source.key === "sampleTargetDir")
      ) {
        return true;
      }

      if (
        activeIsMame287 &&
        (source.key === "mame287SampleSourceDir" ||
          source.key === "mame287SampleTargetDir")
      ) {
        return true;
      }

      return (
        source.key === "fullDir" ||
        source.key === "targetDir" ||
        source.key === "mame287FullDir" ||
        source.key === "mame287TargetDir" ||
        source.key === "fbneoFullDir" ||
        source.key === "fbneoTargetDir" ||
        source.key === "fbneoSampleTargetDir"
      );
    });
  }, [activeIsMame287, activeSet]);

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
    const matchedActiveAssets = entries.filter(
      (entry) => entry.available,
    ).length;
    const matchedTargetAssets = entries.filter(
      (entry) => entry.inTarget,
    ).length;
    const matchedCounterpartAssets = entries.filter(
      (entry) => entry.counterpartAvailable,
    ).length;
    const matchedCounterpartTargetAssets = entries.filter(
      (entry) => entry.counterpartInTarget,
    ).length;
    const sharedPlayable = entries.filter(
      (entry) =>
        entry.isRunnable && entry.available && entry.counterpartAvailable,
    ).length;
    const playableEntries = entries.filter((entry) => entry.isRunnable);
    const missingPlayable = playableEntries.filter(
      (entry) => entry.available && !entry.inTarget,
    ).length;

    return {
      total: entries.length,
      playable: playableEntries.length,
      inSet: matchedTargetAssets,
      counterpartInSet: matchedCounterpartTargetAssets,
      sharedPlayable,
      missingPlayable,
      selected: selectedIds.size,
      copyable: selectedPlan.items.length,
      counterpartCopyable: selectedCounterpartPlan.length,
      sampleCopyable: selectedSamplePlan.items.length,
      sampleNeeded: selectedSamplePlan.required.length,
      sampleGaps:
        playSetSamplePlan.items.length + playSetSamplePlan.missing.length,
      missingPlaySetSamples: playSetSamplePlan.items.length,
      missingPlaySetSampleSources: playSetSamplePlan.missing.length,
      soundtrackCopyable: selectedSoundtrackPlan.items.length,
      removable: selectedRemoveItems.length,
      fullUnmatched: Math.max(0, activeFullAssets.size - matchedActiveAssets),
      counterpartUnmatched: Math.max(
        0,
        counterpartFullAssets.size - matchedCounterpartAssets,
      ),
      targetUnmatched: Math.max(
        0,
        activeTargetAssets.size - matchedTargetAssets,
      ),
    };
  }, [
    activeFullAssets.size,
    activeTargetAssets.size,
    counterpartFullAssets.size,
    entries,
    selectedIds.size,
    selectedCounterpartPlan.length,
    selectedPlan.items.length,
    playSetSamplePlan.items.length,
    playSetSamplePlan.missing.length,
    selectedRemoveItems.length,
    selectedSamplePlan.items.length,
    selectedSamplePlan.required.length,
    selectedSoundtrackPlan.items.length,
  ]);

  const filteredEntries = useMemo(() => {
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);

    const filtered = entries.filter((entry) => {
      if (hideClones && entry.cloneOf) {
        return false;
      }

      if (hideSystemRoms && !entry.isRunnable) {
        return false;
      }

      if (region !== "all" && entry.region !== region) {
        return false;
      }

      if (
        terms.length > 0 &&
        !terms.every((term) => entry.searchText.includes(term))
      ) {
        return false;
      }

      if (view === "missing") {
        return entry.available && !entry.inTarget;
      }

      if (view === "inSet") {
        return entry.inTarget;
      }

      if (view === "shared") {
        return entry.available && entry.counterpartAvailable;
      }

      if (view === "counterpart") {
        return (
          (entry.inTarget &&
            !entry.counterpartInTarget &&
            entry.counterpartAvailable) ||
          (entry.counterpartInTarget && !entry.inTarget && entry.available)
        );
      }

      if (view === "selected") {
        return selectedIds.has(entry.id);
      }

      if (view === "unavailable") {
        return !entry.available;
      }

      return true;
    });

    return filtered.sort((left, right) => compareEntries(left, right, sortKey));
  }, [
    entries,
    hideClones,
    hideSystemRoms,
    query,
    region,
    selectedIds,
    sortKey,
    view,
  ]);

  const canIndex =
    activeSet === "mame"
      ? Boolean(handles.fullDir && handles.targetDir)
      : activeIsMame287
        ? Boolean(handles.mame287FullDir && handles.mame287TargetDir)
        : Boolean(handles.fbneoFullDir && handles.fbneoTargetDir);
  const isBusy =
    isIndexing ||
    Boolean(copyProgress) ||
    Boolean(counterpartProgress) ||
    Boolean(removeProgress) ||
    Boolean(sampleFixProgress);
  const copyWorkCount =
    selectedPlan.items.length +
    selectedSamplePlan.items.length +
    selectedSoundtrackPlan.items.length;
  const counterpartWorkCount = selectedCounterpartPlan.length;
  const copySelectableCount =
    copyWorkCount ||
    (includeSamples ? selectedSamplePlan.required.length : 0) ||
    (includeSoundtracks ? selectedSoundtrackPlan.required.length : 0);

  async function syncSampleHandle(key: SourceKey, handle: FileSystemHandle) {
    if (key === "fbneoFullDir") {
      const source = await resolveRomDirectory(
        handle as FileSystemDirectoryHandle,
        {
          preferRomsSubfolder: true,
        },
      );
      setFbneoAssets(source.assets);
      return;
    }

    if (key === "fbneoTargetDir") {
      setFbneoTargetAssets(
        await listRomAssets(handle as FileSystemDirectoryHandle),
      );
      return;
    }

    if (key === "mame287FullDir") {
      const source = await resolveRomDirectory(
        handle as FileSystemDirectoryHandle,
        {
          preferRomsSubfolder: true,
        },
      );
      setMame287Assets(source.assets);
      return;
    }

    if (key === "mame287TargetDir") {
      setMame287TargetAssets(
        await listRomAssets(handle as FileSystemDirectoryHandle),
      );
      return;
    }

    if (key === "mame287SampleSourceDir") {
      const source = await resolveSampleDirectory(
        handle as FileSystemDirectoryHandle,
        {
          preferSamplesSubfolder: true,
        },
      );
      setMame287SampleSourceAssets(source.assets);
      return;
    }

    if (key === "mame287SampleTargetDir") {
      const target = await resolveSampleDirectory(
        handle as FileSystemDirectoryHandle,
        {
          createSubfolder: true,
          preferSamplesSubfolder: true,
        },
      );
      setMame287SampleTargetAssets(target.assets);
      setMame287SampleTargetDirectory(target.directory);
      return;
    }

    if (key === "fbneoSampleTargetDir") {
      const target = await resolveSampleDirectory(
        handle as FileSystemDirectoryHandle,
        {
          createSubfolder: true,
          preferSamplesSubfolder: true,
        },
      );
      setFbneoSampleTargetAssets(target.assets);
      setFbneoSampleTargetDirectory(target.directory);
      return;
    }

    if (key === "sampleSourceDir") {
      const source = await resolveSampleDirectory(
        handle as FileSystemDirectoryHandle,
        {
          preferSamplesSubfolder: true,
        },
      );
      setSampleSourceAssets(source.assets);
      return;
    }

    if (key === "soundtrackSourceDir") {
      const source = await resolveSoundtrackDirectory(
        handle as FileSystemDirectoryHandle,
        {
          preferSoundtrackSubfolder: true,
        },
      );
      setSoundtrackSourceAssets(source.assets);
      return;
    }

    if (key === "sampleTargetDir") {
      const target = await resolveSampleDirectory(
        handle as FileSystemDirectoryHandle,
        {
          createSubfolder: true,
          preferSamplesSubfolder: true,
        },
      );
      setSampleTargetAssets(target.assets);
      setSampleTargetDirectory(target.directory);
    }
  }

  const chooseSource = useCallback(async (key: SourceKey) => {
    try {
      setError("");
      let handle: FileSystemHandle | undefined;

      if (key === "fullDir") {
        handle = await pickFullDirectory();
      } else if (key === "fbneoFullDir") {
        handle = await pickFbneoFullDirectory();
      } else if (key === "mame287FullDir") {
        handle = await pickFullDirectory();
      } else if (key === "targetDir") {
        handle = await pickTargetDirectory();
      } else if (key === "mame287TargetDir") {
        handle = await pickTargetDirectory();
      } else if (key === "fbneoTargetDir") {
        handle = await pickFbneoTargetDirectory();
      } else if (key === "fbneoSampleTargetDir") {
        handle = await pickFbneoSampleTargetDirectory();
      } else if (key === "mame287SampleSourceDir") {
        handle = await pickSampleSourceDirectory();
      } else if (key === "mame287SampleTargetDir") {
        handle = await pickSampleTargetDirectory();
      } else if (key === "sampleSourceDir") {
        handle = await pickSampleSourceDirectory();
      } else if (key === "sampleTargetDir") {
        handle = await pickSampleTargetDirectory();
      } else if (key === "soundtrackSourceDir") {
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
          detail: "Checking selection...",
          selectedName: handle.name,
          state: "checking",
        },
      }));

      let saveWarning = "";
      try {
        await saveHandle(key, handle);
      } catch {
        saveWarning =
          " Connected for this session, but the browser did not save it for next time.";
      }

      const status = await inspectSource(key, handle);
      await syncSampleHandle(key, handle);
      setSourceStatuses((current) => ({
        ...current,
        [key]: {
          ...status,
          detail: `${status.detail}${saveWarning}`,
          state:
            saveWarning && status.state === "ready" ? "warning" : status.state,
        },
      }));
      setMessage(`${sourceLabel(key)} connected.`);
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") {
        return;
      }

      const detail = getErrorMessage(caught);
      setError(detail);
      setSourceStatuses((current) => ({
        ...current,
        [key]: {
          detail,
          selectedName: current[key].selectedName,
          state: "warning",
        },
      }));
    }
  }, []);

  const indexSources = useCallback(
    async (options: { auto?: boolean } = {}) => {
      if (activeSet === "mame" && (!handles.fullDir || !handles.targetDir)) {
        setError("Choose the MAME full set and playing-set folder first.");
        return;
      }

      if (
        activeSet === "mame287" &&
        (!handles.mame287FullDir || !handles.mame287TargetDir)
      ) {
        setError(
          "Choose the MAME 0.287 full set and playing-set folder first.",
        );
        return;
      }

      if (
        activeSet === "fbneo" &&
        (!handles.fbneoFullDir || !handles.fbneoTargetDir)
      ) {
        setError(
          "Choose the FBNeo full set and FBNeo playing-set folder first.",
        );
        return;
      }

      const fullDir = activeIsMame287
        ? handles.mame287FullDir!
        : handles.fullDir!;
      const targetDir = activeIsMame287
        ? handles.mame287TargetDir!
        : handles.targetDir!;
      const sampleSourceDir = activeIsMame287
        ? handles.mame287SampleSourceDir
        : handles.sampleSourceDir;
      const sampleTargetDir = activeIsMame287
        ? handles.mame287SampleTargetDir
        : handles.sampleTargetDir;

      try {
        setIsIndexing(true);
        setError("");
        setMessage(
          options.auto
            ? "Indexing saved sources..."
            : "Indexing ROM sources...",
        );
        setLastPlan(null);

        if (activeSet === "fbneo") {
          const fbneoFullAllowed = await verifyPermission(
            handles.fbneoFullDir!,
            "read",
          );
          if (!fbneoFullAllowed) {
            throw new Error(
              "The browser did not receive read permission for the FBNeo full set.",
            );
          }

          const fbneoTargetAllowed = await verifyPermission(
            handles.fbneoTargetDir!,
            "readwrite",
          );
          if (!fbneoTargetAllowed) {
            throw new Error(
              "The browser did not receive permission for the FBNeo sources.",
            );
          }

          if (
            handles.fbneoSampleTargetDir &&
            !(await verifyPermission(handles.fbneoSampleTargetDir, "readwrite"))
          ) {
            throw new Error(
              "The browser did not receive write permission for the FBNeo sample target.",
            );
          }

          const [fbneoSource, nextFbneoTargetAssets] = await Promise.all([
            resolveRomDirectory(handles.fbneoFullDir!, {
              preferRomsSubfolder: true,
            }),
            listRomAssets(handles.fbneoTargetDir!),
          ]);
          if (fbneoSource.assets.size === 0) {
            setSourceStatuses((current) => ({
              ...current,
              fbneoFullDir: {
                detail:
                  "No FBNeo ROM archives found. Choose the set folder, games folder, or a folder containing games.",
                selectedName: handles.fbneoFullDir?.name,
                state: "warning",
              },
            }));
            throw new Error("No FBNeo ROM archives were found in the source.");
          }
          const [fbneoSampleSource, fbneoSampleTarget] = await Promise.all([
            resolveSampleSource(null, handles.fbneoFullDir!),
            resolveSampleTarget(handles.fbneoSampleTargetDir),
          ]);
          const fbneoXmlFile = await resolveXmlFile(handles.fbneoFullDir!);
          if (!fbneoXmlFile) {
            setSourceStatuses((current) => ({
              ...current,
              fbneoFullDir: {
                detail:
                  "No XML metadata file found in the FBNeo full set folder.",
                selectedName: handles.fbneoFullDir?.name,
                state: "warning",
              },
            }));
            throw new Error(
              "No FBNeo XML metadata file was found in the full set folder.",
            );
          }
          const nextEntries = parseRomXml(
            await fbneoXmlFile.file.text(),
            fbneoSource.assets,
          );

          setFbneoAssets(fbneoSource.assets);
          setFbneoSampleSourceAssets(fbneoSampleSource.assets);
          setFbneoSampleTargetAssets(fbneoSampleTarget.assets);
          setFbneoSampleTargetDirectory(fbneoSampleTarget.directory);
          setFbneoTargetAssets(nextFbneoTargetAssets);
          setFbneoEntries(nextEntries);
          setSourceStatuses((current) => ({
            ...current,
            fbneoFullDir: {
              detail: `${formatDirectoryStatus(fbneoSource.assets.size, fbneoSource.usedSubfolder, "FBNeo set")} ${fbneoXmlFile.file.name} loaded.`,
              selectedName: fbneoSource.selectedName,
              state: "ready",
            },
            fbneoTargetDir: {
              detail:
                nextFbneoTargetAssets.size > 0
                  ? `${nextFbneoTargetAssets.size.toLocaleString()} ROM item${nextFbneoTargetAssets.size === 1 ? "" : "s"} found in the FBNeo playing set.`
                  : "No ROMs found yet. This FBNeo playing-set folder can still receive copied ROMs.",
              selectedName: handles.fbneoTargetDir?.name,
              state: nextFbneoTargetAssets.size > 0 ? "ready" : "warning",
            },
            fbneoSampleTargetDir: fbneoSampleTarget.available
              ? {
                  detail: formatSampleDirectoryStatus(
                    fbneoSampleTarget.assets.size,
                    fbneoSampleTarget.usedSubfolder,
                    "target",
                  ),
                  selectedName: fbneoSampleTarget.selectedName,
                  state: "ready",
                }
              : current.fbneoSampleTargetDir,
          }));
          setSelectedIds(new Set());
          setLastIndexed(new Date());
          setMessage(
            `${fbneoSource.assets.size.toLocaleString()} FBNeo ROM items indexed with ${nextEntries.length.toLocaleString()} metadata entries.`,
          );
          return;
        }

        const fullAllowed = await verifyPermission(fullDir, "read");
        if (!fullAllowed) {
          throw new Error(
            "The browser did not receive read permission for the MAME full set.",
          );
        }

        const targetAllowed = await verifyPermission(targetDir, "readwrite");
        if (!targetAllowed) {
          throw new Error(
            "The browser did not receive write permission for the MAME playing set.",
          );
        }

        const [autoXmlFile, fullSource, nextTargetAssets] = await Promise.all([
          resolveXmlFile(fullDir),
          resolveRomDirectory(fullDir, { preferRomsSubfolder: true }),
          listRomAssets(targetDir),
        ]);
        const [sampleSource, sampleTarget, soundtrackSource] =
          await Promise.all([
            resolveSampleSource(sampleSourceDir, fullDir).catch(() => ({
              assets: new Map<string, RomAsset>(),
              available: false,
              directory: fullDir,
              effectiveName: fullDir.name,
              selectedName: fullDir.name,
              usedSubfolder: false,
            })),
            resolveSampleTarget(sampleTargetDir).catch(() => ({
              assets: new Map<string, RomAsset>(),
              available: false,
              directory: null,
              effectiveName: "",
              selectedName: "",
              usedSubfolder: false,
            })),
            resolveSoundtrackSource(handles.soundtrackSourceDir, fullDir).catch(
              () => ({
                assets: new Map<string, RomAsset>(),
                available: false,
                directory: fullDir,
                effectiveName: fullDir.name,
                selectedName: fullDir.name,
                usedSubfolder: false,
              }),
            ),
          ]);
        const nextFullAssets = fullSource.assets;
        if (nextFullAssets.size === 0) {
          setSourceStatuses((current) => ({
            ...current,
            [activeIsMame287 ? "mame287FullDir" : "fullDir"]: {
              detail:
                "No ROM archives found. Choose the full set folder or its roms subfolder.",
              selectedName: fullDir.name,
              state: "warning",
            },
          }));
          throw new Error("No ROM archives were found in the full set source.");
        }

        const metadataFile = autoXmlFile?.file ?? null;
        if (!metadataFile) {
          setSourceStatuses((current) => ({
            ...current,
            [activeIsMame287 ? "mame287FullDir" : "fullDir"]: {
              detail: "No XML metadata file found in the MAME full set folder.",
              selectedName: fullDir.name,
              state: "warning",
            },
          }));
          throw new Error(
            "No MAME XML metadata file was found in the full set folder.",
          );
        }
        const nextEntries = parseRomXml(
          await metadataFile.text(),
          nextFullAssets,
        );

        if (activeIsMame287) {
          setMame287Entries(nextEntries);
          setMame287Assets(nextFullAssets);
          setMame287TargetAssets(nextTargetAssets);
          setMame287SampleSourceAssets(sampleSource.assets);
          setMame287SampleTargetAssets(sampleTarget.assets);
          setMame287SampleTargetDirectory(sampleTarget.directory);
        } else {
          setMameEntries(nextEntries);
          setFullAssets(nextFullAssets);
          setTargetAssets(nextTargetAssets);
          setSampleSourceAssets(sampleSource.assets);
          setSampleTargetAssets(sampleTarget.assets);
          setSampleTargetDirectory(sampleTarget.directory);
        }
        setSoundtrackSourceAssets(soundtrackSource.assets);
        setSourceStatuses((current) => ({
          ...current,
          [activeIsMame287 ? "mame287FullDir" : "fullDir"]: {
            detail: formatDirectoryStatus(
              fullSource.assets.size,
              fullSource.usedSubfolder,
              "full set",
            ),
            selectedName: fullSource.selectedName,
            state: "ready",
          },
          [activeIsMame287 ? "mame287TargetDir" : "targetDir"]: {
            detail:
              nextTargetAssets.size > 0
                ? `${nextTargetAssets.size.toLocaleString()} ROM item${nextTargetAssets.size === 1 ? "" : "s"} found in the playing set.`
                : "No ROMs found yet. This playing-set folder can still receive copied ROMs.",
            selectedName: targetDir.name,
            state: nextTargetAssets.size > 0 ? "ready" : "warning",
          },
          fbneoFullDir: current.fbneoFullDir,
          fbneoTargetDir: current.fbneoTargetDir,
          xmlFile: {
            detail: `${metadataFile.name} loaded automatically.`,
            selectedName: metadataFile?.name,
            state: "ready",
          },
          [activeIsMame287 ? "mame287SampleSourceDir" : "sampleSourceDir"]:
            sampleSource.available
              ? {
                  detail: formatSampleDirectoryStatus(
                    sampleSource.assets.size,
                    sampleSource.usedSubfolder,
                    "source",
                  ),
                  selectedName: sampleSource.selectedName,
                  state: sampleSource.assets.size > 0 ? "ready" : "warning",
                }
              : current[
                  activeIsMame287 ? "mame287SampleSourceDir" : "sampleSourceDir"
                ],
          [activeIsMame287 ? "mame287SampleTargetDir" : "sampleTargetDir"]:
            sampleTarget.available
              ? {
                  detail: formatSampleDirectoryStatus(
                    sampleTarget.assets.size,
                    sampleTarget.usedSubfolder,
                    "target",
                  ),
                  selectedName: sampleTarget.selectedName,
                  state: "ready",
                }
              : current[
                  activeIsMame287 ? "mame287SampleTargetDir" : "sampleTargetDir"
                ],
          soundtrackSourceDir: soundtrackSource.available
            ? {
                detail: formatSoundtrackDirectoryStatus(
                  soundtrackSource.assets.size,
                  soundtrackSource.usedSubfolder,
                ),
                selectedName: soundtrackSource.selectedName,
                state: soundtrackSource.assets.size > 0 ? "ready" : "warning",
              }
            : current.soundtrackSourceDir,
        }));
        setSelectedIds(new Set());
        setLastIndexed(new Date());
        setMessage(
          `${nextFullAssets.size.toLocaleString()} MAME ROM items indexed with ${nextEntries.length.toLocaleString()} metadata entries.`,
        );
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
    },
    [
      activeIsMame287,
      activeSet,
      handles.fbneoFullDir,
      handles.fbneoSampleTargetDir,
      handles.fbneoTargetDir,
      handles.fullDir,
      handles.mame287FullDir,
      handles.mame287SampleSourceDir,
      handles.mame287SampleTargetDir,
      handles.mame287TargetDir,
      handles.sampleSourceDir,
      handles.sampleTargetDir,
      handles.soundtrackSourceDir,
      handles.targetDir,
      handles.xmlFile,
    ],
  );

  useEffect(() => {
    if (!autoScanPending || !canIndex || isBusy || lastIndexed) {
      return;
    }

    setAutoScanPending(false);
    void indexSources({ auto: true });
  }, [autoScanPending, canIndex, indexSources, isBusy, lastIndexed]);

  useEffect(() => {
    setSelectedIds(new Set());
    setLastPlan(null);
  }, [activeSet]);

  const copySelected = useCallback(async () => {
    if (!activeTargetDir) {
      setError("Choose a playing set folder first.");
      return;
    }

    const plan = buildCopyPlan(
      selectedIds,
      entries,
      activeTargetAssets,
      includeDependencies,
    );
    const possibleSamplePlan =
      activeSet === "mame"
        ? buildSamplePlan(
            selectedIds,
            entries,
            sampleSourceAssets,
            sampleTargetAssets,
          )
        : activeIsMame287
          ? buildSamplePlan(
              selectedIds,
              entries,
              mame287SampleSourceAssets,
              mame287SampleTargetAssets,
            )
          : buildMatchingSamplePlan(
              selectedIds,
              entries,
              fbneoSampleSourceAssets,
              fbneoSampleTargetAssets,
            );
    let shouldCopySamples = includeSamples;
    if (!shouldCopySamples && possibleSamplePlan.required.length > 0) {
      shouldCopySamples = window.confirm(
        `Selected ROMs require ${possibleSamplePlan.required.length.toLocaleString()} sample pack${possibleSamplePlan.required.length === 1 ? "" : "s"}. Copy samples too?`,
      );
    }

    const samplePlan = shouldCopySamples
      ? activeSet === "mame"
        ? buildSamplePlan(
            selectedIds,
            entries,
            sampleSourceAssets,
            sampleTargetAssets,
          )
        : activeIsMame287
          ? buildSamplePlan(
              selectedIds,
              entries,
              mame287SampleSourceAssets,
              mame287SampleTargetAssets,
            )
          : buildMatchingSamplePlan(
              selectedIds,
              entries,
              fbneoSampleSourceAssets,
              fbneoSampleTargetAssets,
            )
      : {
          alreadyPresent: [],
          items: [],
          missing: [],
          required: [],
        };
    const soundtrackPlan =
      activeSet === "mame" && includeSoundtracks
        ? buildSoundtrackPlan(
            selectedIds,
            entries,
            soundtrackSourceAssets,
            sampleTargetAssets,
          )
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
      if (activeSampleSourceAssets.size === 0) {
        optionalNotes.push("samples skipped: choose a sample source folder");
        copySamplePlan = emptySamplePlan();
      } else if (!activeSampleTargetDirectory) {
        optionalNotes.push(
          activeSet === "fbneo"
            ? "samples skipped: choose the FBNeo samples target folder, usually bios\\fbneo\\samples"
            : "samples skipped: choose a sample target folder",
        );
        copySamplePlan = emptySamplePlan();
      } else if (samplePlan.missing.length > 0) {
        const missing = samplePlan.missing
          .map((sample) => sample.sampleId)
          .join(", ");
        optionalNotes.push(
          `sample pack${samplePlan.missing.length === 1 ? "" : "s"} unavailable: ${missing}`,
        );
      }
    }

    if (soundtrackPlan.required.length > 0) {
      if (soundtrackSourceAssets.size === 0) {
        optionalNotes.push("OST skipped: choose an OST source folder");
        copySoundtrackPlan = emptySamplePlan();
      } else if (!sampleTargetDirectory) {
        optionalNotes.push("OST skipped: choose a sample target folder");
        copySoundtrackPlan = emptySamplePlan();
      } else if (soundtrackPlan.missing.length > 0) {
        const missing = soundtrackPlan.missing
          .map((sample) => sample.sampleId)
          .join(", ");
        optionalNotes.push(
          `OST pack${soundtrackPlan.missing.length === 1 ? "" : "s"} unavailable: ${missing}`,
        );
      }
    }

    if (
      plan.items.length === 0 &&
      copySamplePlan.items.length === 0 &&
      copySoundtrackPlan.items.length === 0
    ) {
      setMessage(["Nothing new to copy.", ...optionalNotes].join(" "));
      return;
    }

    const targetDir = activeTargetDir;
    const samplesDir = activeSampleTargetDirectory;

    try {
      setError("");
      const [targetAllowed, samplesAllowed] = await Promise.all([
        verifyPermission(targetDir, "readwrite"),
        samplesDir
          ? verifyPermission(samplesDir, "readwrite")
          : Promise.resolve(true),
      ]);
      if (!targetAllowed) {
        throw new Error(
          "The browser did not receive write permission for the playing set.",
        );
      }
      if (!samplesAllowed) {
        throw new Error(
          "The browser did not receive write permission for the sample target.",
        );
      }

      for (let index = 0; index < plan.items.length; index += 1) {
        const item = plan.items[index];
        setCopyProgress({
          current: index + 1,
          total:
            plan.items.length +
            copySamplePlan.items.length +
            copySoundtrackPlan.items.length,
          label: item.asset.name,
        });
        await copyAssetToDirectory(item.asset, targetDir);
      }

      for (let index = 0; index < copySamplePlan.items.length; index += 1) {
        const item = copySamplePlan.items[index];
        setCopyProgress({
          current: plan.items.length + index + 1,
          total:
            plan.items.length +
            copySamplePlan.items.length +
            copySoundtrackPlan.items.length,
          label: item.asset.name,
        });
        await copyAssetToDirectory(item.asset, samplesDir!);
      }

      for (let index = 0; index < copySoundtrackPlan.items.length; index += 1) {
        const item = copySoundtrackPlan.items[index];
        setCopyProgress({
          current: plan.items.length + copySamplePlan.items.length + index + 1,
          total:
            plan.items.length +
            copySamplePlan.items.length +
            copySoundtrackPlan.items.length,
          label: item.asset.name,
        });
        await copyAssetToDirectory(item.asset, samplesDir!);
      }

      const [refreshedTargetAssets, refreshedSampleAssets] = await Promise.all([
        listRomAssets(targetDir),
        samplesDir
          ? listSampleAssets(samplesDir)
          : Promise.resolve(activeSampleTargetAssets),
      ]);
      if (activeSet === "mame") {
        setTargetAssets(refreshedTargetAssets);
      } else if (activeIsMame287) {
        setMame287TargetAssets(refreshedTargetAssets);
      } else {
        setFbneoTargetAssets(refreshedTargetAssets);
      }
      if (activeSet === "mame") {
        setSampleTargetAssets(refreshedSampleAssets);
      } else if (activeIsMame287) {
        setMame287SampleTargetAssets(refreshedSampleAssets);
      } else {
        setFbneoSampleTargetAssets(refreshedSampleAssets);
      }
      setSourceStatuses((current) => ({
        ...current,
        [activeTargetSourceKey]: {
          detail: `${refreshedTargetAssets.size.toLocaleString()} ROM item${refreshedTargetAssets.size === 1 ? "" : "s"} found in the ${activeSetOption.label} playing set.`,
          selectedName: targetDir.name,
          state: "ready",
        },
        [activeSampleTargetSourceKey]: samplesDir
          ? {
              detail: `${refreshedSampleAssets.size.toLocaleString()} sample pack${refreshedSampleAssets.size === 1 ? "" : "s"} found in the sample target.`,
              selectedName: samplesDir.name,
              state: "ready",
            }
          : current[activeSampleTargetSourceKey],
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
      const romText = `${plan.items.length.toLocaleString()} ROM item${plan.items.length === 1 ? "" : "s"}`;
      const sampleText = `${copySamplePlan.items.length.toLocaleString()} sample pack${copySamplePlan.items.length === 1 ? "" : "s"}`;
      const soundtrackText = `${copySoundtrackPlan.items.length.toLocaleString()} OST pack${copySoundtrackPlan.items.length === 1 ? "" : "s"}`;
      const copiedText =
        activeSet === "fbneo"
          ? `${romText} copied.`
          : activeSet === "mame" && includeSoundtracks
            ? `${romText}, ${sampleText}, and ${soundtrackText} copied.`
            : `${romText} and ${sampleText} copied.`;
      setMessage([copiedText, ...optionalNotes].join(" "));
    } catch (caught) {
      setError(getErrorMessage(caught));
    } finally {
      setCopyProgress(null);
    }
  }, [
    activeSet,
    activeSetOption.label,
    activeSampleSourceAssets.size,
    activeTargetAssets,
    activeTargetDir,
    activeSampleTargetDirectory,
    activeSampleTargetSourceKey,
    activeTargetSourceKey,
    activeIsMame287,
    activeSampleTargetAssets,
    entries,
    fbneoSampleSourceAssets,
    fbneoSampleTargetAssets,
    includeDependencies,
    includeSamples,
    includeSoundtracks,
    mame287SampleSourceAssets,
    mame287SampleTargetAssets,
    sampleSourceAssets,
    sampleTargetAssets,
    sampleTargetDirectory,
    selectedIds,
    soundtrackSourceAssets,
  ]);

  const copyCounterparts = useCallback(async () => {
    if (!activeTargetDir || !counterpartTargetDir) {
      setError("Choose both playing-set folders before copying counterparts.");
      return;
    }

    const plan = buildCounterpartPlan(
      selectedIds,
      entries,
      activeTargetDir,
      counterpartTargetDir,
      removeOriginalAfterCounterpartCopy,
    );
    if (plan.length === 0) {
      setMessage("No selected ROMs need a counterpart copy.");
      return;
    }

    const directionLabels = new Set(plan.map((item) => item.direction));
    const confirmed =
      !removeOriginalAfterCounterpartCopy ||
      window.confirm(
        `Copy ${plan.length.toLocaleString()} counterpart ROM item${plan.length === 1 ? "" : "s"}, verify the copied files are present, then remove the original version from the other playing set?`,
      );
    if (!confirmed) {
      return;
    }

    try {
      setError("");
      const [activeAllowed, counterpartAllowed] = await Promise.all([
        verifyPermission(activeTargetDir, "readwrite"),
        verifyPermission(counterpartTargetDir, "readwrite"),
      ]);
      if (!activeAllowed || !counterpartAllowed) {
        throw new Error(
          "The browser did not receive write permission for both playing sets.",
        );
      }

      for (let index = 0; index < plan.length; index += 1) {
        const item = plan[index];
        setCounterpartProgress({
          current: index + 1,
          total: plan.length,
          label: item.sourceAsset.name,
        });
        await copyAssetToDirectory(item.sourceAsset, item.targetDirectory);
      }

      const [afterCopyActiveAssets, afterCopyCounterpartAssets] =
        await Promise.all([
          listRomAssets(activeTargetDir),
          listRomAssets(counterpartTargetDir),
        ]);
      const removals = removeOriginalAfterCounterpartCopy
        ? getVerifiedCounterpartRemovals(
            plan,
            afterCopyActiveAssets,
            afterCopyCounterpartAssets,
          )
        : [];

      for (let index = 0; index < removals.length; index += 1) {
        const item = removals[index];
        setCounterpartProgress({
          current: index + 1,
          total: removals.length,
          label: item.asset.name,
        });
        await removeAssetFromDirectory(item.asset, item.target);
      }

      const [refreshedActiveAssets, refreshedCounterpartTargetAssets] =
        removals.length > 0
          ? await Promise.all([
              listRomAssets(activeTargetDir),
              listRomAssets(counterpartTargetDir),
            ])
          : [afterCopyActiveAssets, afterCopyCounterpartAssets];

      if (activeSet === "mame") {
        setTargetAssets(refreshedActiveAssets);
        setFbneoTargetAssets(refreshedCounterpartTargetAssets);
      } else if (activeIsMame287) {
        setMame287TargetAssets(refreshedActiveAssets);
        setFbneoTargetAssets(refreshedCounterpartTargetAssets);
      } else {
        setFbneoTargetAssets(refreshedActiveAssets);
        setTargetAssets(refreshedCounterpartTargetAssets);
      }
      setSourceStatuses((current) => ({
        ...current,
        [activeTargetSourceKey]: {
          detail: `${refreshedActiveAssets.size.toLocaleString()} ROM item${refreshedActiveAssets.size === 1 ? "" : "s"} found in the ${activeSetOption.label} playing set.`,
          selectedName: activeTargetDir.name,
          state: "ready",
        },
        [counterpartTargetSourceKey]: {
          detail: `${refreshedCounterpartTargetAssets.size.toLocaleString()} ROM item${refreshedCounterpartTargetAssets.size === 1 ? "" : "s"} found in the ${counterpartSetOption.label} playing set.`,
          selectedName: counterpartTargetDir.name,
          state: "ready",
        },
      }));
      setSelectedIds((current) => {
        const completed = new Set(plan.map((item) => item.entry.id));
        return new Set([...current].filter((id) => !completed.has(id)));
      });

      const directions =
        directionLabels.size === 2
          ? "both directions"
          : directionLabels.has("primaryToCounterpart")
            ? `to ${counterpartSetOption.label}`
            : `to ${activeSetOption.label}`;
      setMessage(
        `${plan.length.toLocaleString()} counterpart ROM item${plan.length === 1 ? "" : "s"} copied ${directions}. ${
          removals.length > 0
            ? `${removals.length.toLocaleString()} verified original${removals.length === 1 ? "" : "s"} removed.`
            : "Original versions were kept."
        }`,
      );
    } catch (caught) {
      setError(getErrorMessage(caught));
    } finally {
      setCounterpartProgress(null);
    }
  }, [
    activeSet,
    activeSetOption.label,
    activeIsMame287,
    activeTargetDir,
    activeTargetSourceKey,
    counterpartSetOption.label,
    counterpartTargetDir,
    counterpartTargetSourceKey,
    entries,
    removeOriginalAfterCounterpartCopy,
    selectedIds,
  ]);

  const fixPlaySetSamples = useCallback(async () => {
    if (playSetSamplePlan.required.length === 0) {
      setMessage("No sample packs are required by the current playing set.");
      return;
    }

    if (playSetSamplePlan.items.length === 0) {
      if (playSetSamplePlan.missing.length > 0) {
        const missing = playSetSamplePlan.missing
          .map((sample) => sample.sampleId)
          .join(", ");
        setError(
          `The playing set needs sample packs that were not found in the sample source: ${missing}.`,
        );
      } else {
        setMessage("All required playing-set sample packs are present.");
      }
      return;
    }

    if (!activeSampleTargetDirectory) {
      setError(
        activeSet === "fbneo"
          ? "Choose the FBNeo sample target folder before fixing samples. Use bios\\fbneo\\samples."
          : "Choose a sample target folder before fixing playing-set samples.",
      );
      return;
    }

    try {
      setError("");
      const targetAllowed = await verifyPermission(
        activeSampleTargetDirectory,
        "readwrite",
      );
      if (!targetAllowed) {
        throw new Error(
          "The browser did not receive write permission for the sample target.",
        );
      }

      for (let index = 0; index < playSetSamplePlan.items.length; index += 1) {
        const item = playSetSamplePlan.items[index];
        setSampleFixProgress({
          current: index + 1,
          total: playSetSamplePlan.items.length,
          label: item.asset.name,
        });
        await copyAssetToDirectory(item.asset, activeSampleTargetDirectory);
      }

      const refreshedSampleAssets = await listSampleAssets(
        activeSampleTargetDirectory,
      );
      if (activeSet === "mame") {
        setSampleTargetAssets(refreshedSampleAssets);
      } else if (activeIsMame287) {
        setMame287SampleTargetAssets(refreshedSampleAssets);
      } else {
        setFbneoSampleTargetAssets(refreshedSampleAssets);
      }
      setSourceStatuses((current) => ({
        ...current,
        [activeSampleTargetSourceKey]: {
          detail: `${refreshedSampleAssets.size.toLocaleString()} sample pack${refreshedSampleAssets.size === 1 ? "" : "s"} found in the sample target.`,
          selectedName: activeSampleTargetDirectory.name,
          state: "ready",
        },
      }));
      setMessage(
        `${playSetSamplePlan.items.length.toLocaleString()} missing playing-set sample pack${playSetSamplePlan.items.length === 1 ? "" : "s"} copied.`,
      );
    } catch (caught) {
      setError(getErrorMessage(caught));
    } finally {
      setSampleFixProgress(null);
    }
  }, [
    activeIsMame287,
    activeSet,
    activeSampleTargetDirectory,
    activeSampleTargetSourceKey,
    playSetSamplePlan,
  ]);

  const removeSelected = useCallback(async () => {
    if (!activeTargetDir) {
      setError("Choose a playing set folder first.");
      return;
    }

    if (selectedRemoveItems.length === 0) {
      setMessage("No selected ROMs are in the playing set.");
      return;
    }

    const confirmed = window.confirm(
      `Remove ${selectedRemoveItems.length.toLocaleString()} ROM item${selectedRemoveItems.length === 1 ? "" : "s"} from the playing set?`,
    );
    if (!confirmed) {
      return;
    }

    try {
      setError("");
      const targetAllowed = await verifyPermission(
        activeTargetDir,
        "readwrite",
      );
      if (!targetAllowed) {
        throw new Error(
          "The browser did not receive write permission for the playing set.",
        );
      }

      for (let index = 0; index < selectedRemoveItems.length; index += 1) {
        const item = selectedRemoveItems[index];
        setRemoveProgress({
          current: index + 1,
          total: selectedRemoveItems.length,
          label: item.asset.name,
        });
        await removeAssetFromDirectory(item.asset, activeTargetDir);
      }

      const refreshedTargetAssets = await listRomAssets(activeTargetDir);
      if (activeSet === "mame") {
        setTargetAssets(refreshedTargetAssets);
      } else if (activeIsMame287) {
        setMame287TargetAssets(refreshedTargetAssets);
      } else {
        setFbneoTargetAssets(refreshedTargetAssets);
      }
      setSourceStatuses((current) => ({
        ...current,
        [activeTargetSourceKey]: {
          detail: `${refreshedTargetAssets.size.toLocaleString()} ROM item${refreshedTargetAssets.size === 1 ? "" : "s"} found in the ${activeSetOption.label} playing set.`,
          selectedName: activeTargetDir.name,
          state: "ready",
        },
      }));
      setSelectedIds((current) => {
        const removed = new Set(
          selectedRemoveItems.map((item) => item.entry.id),
        );
        return new Set([...current].filter((id) => !removed.has(id)));
      });
      setMessage(
        `${selectedRemoveItems.length.toLocaleString()} ROM item${selectedRemoveItems.length === 1 ? "" : "s"} removed.`,
      );
    } catch (caught) {
      setError(getErrorMessage(caught));
    } finally {
      setRemoveProgress(null);
    }
  }, [
    activeIsMame287,
    activeSet,
    activeSetOption.label,
    activeTargetDir,
    activeTargetSourceKey,
    selectedRemoveItems,
  ]);

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
            <p>{activeSetOption.label}</p>
          </div>
        </div>

        <div className="topbar-actions">
          <label className="set-picker">
            <span>Set</span>
            <select
              value={activeSet}
              onChange={(event) =>
                setActiveSet(event.target.value as ManagedSetKey)
              }
              disabled={isBusy}
            >
              {SET_OPTIONS.map((option) => (
                <option key={option.key} value={option.key}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <button
            className="button secondary"
            type="button"
            onClick={() => indexSources()}
            disabled={!canIndex || isBusy}
          >
            {isIndexing ? (
              <Loader2 className="spin" aria-hidden="true" />
            ) : (
              <RefreshCw aria-hidden="true" />
            )}
            <span>Scan</span>
          </button>
          <button
            className="button secondary"
            type="button"
            onClick={fixPlaySetSamples}
            disabled={playSetSamplePlan.items.length === 0 || isBusy}
            title={`${playSetSamplePlan.items.length.toLocaleString()} missing sample pack${playSetSamplePlan.items.length === 1 ? "" : "s"} can be copied; ${playSetSamplePlan.missing.length.toLocaleString()} missing from source`}
          >
            {sampleFixProgress ? (
              <Loader2 className="spin" aria-hidden="true" />
            ) : (
              <PackageOpen aria-hidden="true" />
            )}
            <span>
              Fix Samples{" "}
              {playSetSamplePlan.items.length > 0
                ? playSetSamplePlan.items.length.toLocaleString()
                : ""}
            </span>
          </button>
          <button
            className="button primary"
            type="button"
            onClick={copySelected}
            disabled={copySelectableCount === 0 || isBusy}
            title={`${selectedPlan.items.length.toLocaleString()} ROM item${selectedPlan.items.length === 1 ? "" : "s"}, ${selectedSamplePlan.items.length.toLocaleString()} sample pack${selectedSamplePlan.items.length === 1 ? "" : "s"}, and ${selectedSoundtrackPlan.items.length.toLocaleString()} OST pack${selectedSoundtrackPlan.items.length === 1 ? "" : "s"} ready`}
          >
            {copyProgress ? (
              <Loader2 className="spin" aria-hidden="true" />
            ) : (
              <Copy aria-hidden="true" />
            )}
            <span>
              Copy {copyWorkCount > 0 ? copyWorkCount.toLocaleString() : ""}
            </span>
          </button>
          <button
            className="button secondary"
            type="button"
            onClick={copyCounterparts}
            disabled={counterpartWorkCount === 0 || isBusy}
            title={`${counterpartWorkCount.toLocaleString()} counterpart ROM item${counterpartWorkCount === 1 ? "" : "s"} ready`}
          >
            {counterpartProgress ? (
              <Loader2 className="spin" aria-hidden="true" />
            ) : (
              <ArrowLeftRight aria-hidden="true" />
            )}
            <span>
              Swap{" "}
              {counterpartWorkCount > 0
                ? counterpartWorkCount.toLocaleString()
                : ""}
            </span>
          </button>
          <button
            className="button danger"
            type="button"
            onClick={removeSelected}
            disabled={selectedRemoveItems.length === 0 || isBusy}
            title={`${selectedRemoveItems.length.toLocaleString()} item${selectedRemoveItems.length === 1 ? "" : "s"} removable`}
          >
            {removeProgress ? (
              <Loader2 className="spin" aria-hidden="true" />
            ) : (
              <Trash2 aria-hidden="true" />
            )}
            <span>
              Remove{" "}
              {selectedRemoveItems.length > 0
                ? selectedRemoveItems.length.toLocaleString()
                : ""}
            </span>
          </button>
        </div>
      </header>

      <section className="source-strip" aria-label="Sources">
        {visibleSources.map((source) => (
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
          <span>{message || "Choose sources, then scan."}</span>
        </div>
        <span>
          {lastIndexed
            ? `Indexed ${lastIndexed.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
            : ""}
        </span>
      </section>

      {error ? (
        <InlineError message={error} onDismiss={() => setError("")} />
      ) : null}

      <section className="metrics-grid" aria-label="Set metrics">
        <Metric label="Indexed" value={stats.total} />
        <Metric label="Playable" value={stats.playable} />
        <Metric label="In set" value={stats.inSet} tone="good" />
        <Metric
          label={`${counterpartSetOption.shortLabel} set`}
          value={stats.counterpartInSet}
          tone="good"
        />
        <Metric label="Shared" value={stats.sharedPlayable} />
        <Metric label="Missing" value={stats.missingPlayable} tone="warn" />
        <Metric label="Selected" value={stats.selected} />
        <Metric label="Copyable" value={stats.copyable} tone="action" />
        <Metric
          label="Counterpart"
          value={stats.counterpartCopyable}
          tone="action"
        />
        <Metric label="Samples" value={stats.sampleCopyable} tone="action" />
        <Metric
          label="Sample gaps"
          value={stats.sampleGaps}
          tone={stats.sampleGaps > 0 ? "warn" : "good"}
        />
        <Metric label="OST" value={stats.soundtrackCopyable} tone="action" />
        <Metric label="Removable" value={stats.removable} tone="danger" />
        <Metric label="Full extras" value={stats.fullUnmatched} />
        <Metric
          label={`${counterpartSetOption.shortLabel} extras`}
          value={stats.counterpartUnmatched}
        />
        <Metric label="Set extras" value={stats.targetUnmatched} />
      </section>

      <section className="manager-panel">
        <div className="toolbar">
          <DebouncedSearchBox value={query} onChange={setQuery} />

          <div className="segmented" aria-label="View">
            {VIEW_OPTIONS.map((option) => (
              <button
                key={option.key}
                className={view === option.key ? "active" : ""}
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
              <select
                value={region}
                onChange={(event) => setRegion(event.target.value)}
              >
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
              <select
                value={sortKey}
                onChange={(event) => setSortKey(event.target.value as SortKey)}
              >
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
            <input
              type="checkbox"
              checked={includeDependencies}
              onChange={(event) => setIncludeDependencies(event.target.checked)}
            />
            <span>Copy parents</span>
          </label>
          <label className="check-option">
            <input
              type="checkbox"
              checked={includeSamples}
              onChange={(event) => setIncludeSamples(event.target.checked)}
            />
            <span>Copy samples</span>
          </label>
          {activeSet === "mame" ? (
            <>
              <label className="check-option">
                <input
                  type="checkbox"
                  checked={includeSoundtracks}
                  onChange={(event) =>
                    setIncludeSoundtracks(event.target.checked)
                  }
                />
                <span>Copy OST</span>
              </label>
            </>
          ) : null}
          <label className="check-option">
            <input
              type="checkbox"
              checked={removeOriginalAfterCounterpartCopy}
              onChange={(event) =>
                setRemoveOriginalAfterCounterpartCopy(event.target.checked)
              }
            />
            <span>Remove after swap</span>
          </label>
          <label className="check-option">
            <input
              type="checkbox"
              checked={hideClones}
              onChange={(event) => setHideClones(event.target.checked)}
            />
            <span>Hide clones</span>
          </label>
          <label className="check-option">
            <input
              type="checkbox"
              checked={hideSystemRoms}
              onChange={(event) => setHideSystemRoms(event.target.checked)}
            />
            <span>Hide BIOS</span>
          </label>

          <div className="row-actions">
            <button
              className="icon-button label-button"
              type="button"
              onClick={selectVisibleMissing}
              disabled={filteredEntries.length === 0}
            >
              <ListChecks aria-hidden="true" />
              <span>Select visible</span>
            </button>
            <button
              className="icon-button label-button"
              type="button"
              onClick={clearSelected}
              disabled={selectedIds.size === 0}
            >
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

        {counterpartProgress ? (
          <div className="copy-progress">
            <div>
              <strong>
                Swapping {counterpartProgress.current} of{" "}
                {counterpartProgress.total}
              </strong>
              <span>{counterpartProgress.label}</span>
            </div>
            <progress
              value={counterpartProgress.current}
              max={counterpartProgress.total}
            />
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
            <progress
              value={removeProgress.current}
              max={removeProgress.total}
            />
          </div>
        ) : null}

        {sampleFixProgress ? (
          <div className="copy-progress">
            <div>
              <strong>
                Fixing samples {sampleFixProgress.current} of{" "}
                {sampleFixProgress.total}
              </strong>
              <span>{sampleFixProgress.label}</span>
            </div>
            <progress
              value={sampleFixProgress.current}
              max={sampleFixProgress.total}
            />
          </div>
        ) : null}

        {playSetSamplePlan.items.length > 0 ||
        playSetSamplePlan.missing.length > 0 ? (
          <div className="plan-note">
            <PackageOpen aria-hidden="true" />
            <span>
              Playing set sample gaps: {playSetSamplePlan.items.length} fixable
              {playSetSamplePlan.missing.length > 0
                ? ` - ${playSetSamplePlan.missing.length} missing from source`
                : ""}
            </span>
          </div>
        ) : null}

        {lastPlan &&
        (lastPlan.missing.length > 0 || lastPlan.alreadyPresent.length > 0) ? (
          <div className="plan-note">
            <Settings2 aria-hidden="true" />
            <span>
              {lastPlan.missing.length > 0
                ? `${lastPlan.missing.length} missing source`
                : ""}
              {lastPlan.missing.length > 0 && lastPlan.alreadyPresent.length > 0
                ? " - "
                : ""}
              {lastPlan.alreadyPresent.length > 0
                ? `${lastPlan.alreadyPresent.length} already present`
                : ""}
            </span>
          </div>
        ) : null}

        {selectedCounterpartPlan.length > 0 ? (
          <div className="plan-note">
            <ArrowLeftRight aria-hidden="true" />
            <span>
              {selectedCounterpartPlan.length.toLocaleString()} counterpart ROM
              item
              {selectedCounterpartPlan.length === 1 ? "" : "s"} ready
              {removeOriginalAfterCounterpartCopy
                ? " - originals will be removed only after the copied version is verified"
                : ""}
            </span>
          </div>
        ) : null}

        {includeSamples && selectedSamplePlan.required.length > 0 ? (
          <div className="plan-note">
            <PackageOpen aria-hidden="true" />
            <span>
              {selectedSamplePlan.items.length > 0
                ? `${selectedSamplePlan.items.length} sample copyable`
                : ""}
              {selectedSamplePlan.items.length > 0 &&
              selectedSamplePlan.missing.length > 0
                ? " - "
                : ""}
              {selectedSamplePlan.missing.length > 0
                ? `${selectedSamplePlan.missing.length} missing sample source`
                : ""}
              {selectedSamplePlan.items.length === 0 &&
              selectedSamplePlan.missing.length === 0
                ? `${selectedSamplePlan.alreadyPresent.length} sample already present`
                : ""}
            </span>
          </div>
        ) : null}

        {includeSoundtracks && selectedSoundtrackPlan.required.length > 0 ? (
          <div className="plan-note">
            <PackageOpen aria-hidden="true" />
            <span>
              {selectedSoundtrackPlan.items.length > 0
                ? `${selectedSoundtrackPlan.items.length} OST copyable`
                : ""}
              {selectedSoundtrackPlan.items.length > 0 &&
              selectedSoundtrackPlan.missing.length > 0
                ? " - "
                : ""}
              {selectedSoundtrackPlan.missing.length > 0
                ? `${selectedSoundtrackPlan.missing.length} missing OST source`
                : ""}
              {selectedSoundtrackPlan.items.length === 0 &&
              selectedSoundtrackPlan.missing.length === 0
                ? `${selectedSoundtrackPlan.alreadyPresent.length} OST already present`
                : ""}
            </span>
          </div>
        ) : null}

        <RomTable
          activeLabel={activeSetOption.shortLabel}
          counterpartLabel={counterpartSetOption.shortLabel}
          entries={filteredEntries}
          sampleSourceAssets={activeSampleSourceAssets}
          sampleTargetAssets={activeSampleTargetAssets}
          selectedIds={selectedIds}
          onToggle={toggleSelected}
        />
      </section>
    </main>
  );
}

function DebouncedSearchBox({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const [draftValue, setDraftValue] = useState(value);
  const lastCommittedValue = useRef(value);

  useEffect(() => {
    if (value !== lastCommittedValue.current) {
      lastCommittedValue.current = value;
      setDraftValue(value);
    }
  }, [value]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      lastCommittedValue.current = draftValue;
      onChange(draftValue);
    }, SEARCH_DEBOUNCE_MS);

    return () => window.clearTimeout(timeoutId);
  }, [draftValue, onChange]);

  return (
    <label className="search-box">
      <Search aria-hidden="true" />
      <input
        value={draftValue}
        onChange={(event) => setDraftValue(event.target.value)}
        placeholder="Search title, file, maker, year"
      />
    </label>
  );
}

function InlineError({
  message,
  onDismiss,
}: {
  message: string;
  onDismiss: () => void;
}) {
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
  const isReady = status.state === "ready";
  const isChecking = status.state === "checking";
  const handleName = status.selectedName || handle?.name || "";
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
            <CircleAlert
              aria-label={handle ? "Needs attention" : "Not connected"}
            />
          )}
        </div>
        <p>{status.detail}</p>
        <code title={displayLabel}>Label: {displayLabel}</code>
        {handleName ? (
          <code title={handleName}>Handle: {handleName}</code>
        ) : null}
      </div>
      <div className="source-actions">
        <button
          className="icon-button"
          type="button"
          onClick={onPick}
          title={`Choose ${config.label}`}
          aria-label={`Choose ${config.label}`}
        >
          <FolderOpen aria-hidden="true" />
        </button>
      </div>
    </article>
  );
}

function Metric({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: number;
  tone?: "neutral" | "good" | "warn" | "action" | "danger";
}) {
  return (
    <div className={`metric metric-${tone}`}>
      <span>{label}</span>
      <strong>{value.toLocaleString()}</strong>
    </div>
  );
}

function RomTable({
  activeLabel,
  counterpartLabel,
  entries,
  sampleSourceAssets,
  sampleTargetAssets,
  selectedIds,
  onToggle,
}: {
  activeLabel: string;
  counterpartLabel: string;
  entries: RomEntry[];
  sampleSourceAssets: Map<string, RomAsset>;
  sampleTargetAssets: Map<string, RomAsset>;
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
            <th className="rom-col">{activeLabel}</th>
            <th className="fbneo-col">{counterpartLabel}</th>
            <th className="samples-col">Samples</th>
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
              <td colSpan={12} className="empty-cell">
                No ROMs match the current view.
              </td>
            </tr>
          ) : (
            entries.map((entry) => (
              <RomRow
                key={entry.id}
                entry={entry}
                checked={selectedIds.has(entry.id)}
                sampleSourceAssets={sampleSourceAssets}
                sampleTargetAssets={sampleTargetAssets}
                onToggle={() => onToggle(entry.id)}
              />
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function RomRow({
  entry,
  checked,
  sampleSourceAssets,
  sampleTargetAssets,
  onToggle,
}: {
  entry: RomEntry;
  checked: boolean;
  sampleSourceAssets: Map<string, RomAsset>;
  sampleTargetAssets: Map<string, RomAsset>;
  onToggle: () => void;
}) {
  const status = entry.inTarget
    ? "In set"
    : entry.available
      ? "Missing"
      : "No source";
  const statusClass = entry.inTarget
    ? "status-in"
    : entry.available
      ? "status-missing"
      : "status-none";
  const sampleStatus = getSampleStatus(
    entry,
    sampleSourceAssets,
    sampleTargetAssets,
  );
  const details = [
    entry.cloneOf
      ? `clone: ${entry.cloneOf}${entry.parentTitle ? ` (${entry.parentTitle})` : ""}`
      : "",
    entry.genre || entry.category,
    entry.driverStatus,
    entry.driverName ? `driver: ${entry.driverName}` : "",
    entry.sampleArchiveIds.length > 0
      ? `samples: ${entry.sampleArchiveIds.join(", ")}`
      : "",
    entry.display,
  ].filter(Boolean);

  return (
    <tr className={checked ? "selected-row" : ""}>
      <td className="select-col">
        <input
          type="checkbox"
          checked={checked}
          onChange={onToggle}
          disabled={
            !entry.inTarget &&
            !entry.available &&
            !entry.counterpartInTarget &&
            !entry.counterpartAvailable
          }
          aria-label={`Select ${entry.title}`}
        />
      </td>
      <td className="status-col">
        <span className={`status-pill ${statusClass}`}>{status}</span>
      </td>
      <td>
        <div className="game-title">{entry.title}</div>
        <div className="game-detail">{details.join(" | ") || "Arcade"}</div>
      </td>
      <td className="rom-col">
        <code className="rom-code">
          {entry.fullAssetName || `${entry.id}.zip`}
        </code>
        {entry.targetAssetName && (
          <div className="game-detail">{entry.targetAssetName}</div>
        )}
      </td>
      <td className="fbneo-col">
        <code className="rom-code">{entry.counterpartAssetName || "-"}</code>
        {entry.counterpartTargetAssetName && (
          <div className="game-detail">{entry.counterpartTargetAssetName}</div>
        )}
      </td>
      <td className="samples-col">
        <span
          className={`sample-pill ${sampleStatus.className}`}
          title={sampleStatus.title}
        >
          {sampleStatus.label}
        </span>
        {sampleStatus.detail ? (
          <div className="game-detail">{sampleStatus.detail}</div>
        ) : null}
      </td>
      <td className="region-col">{entry.region}</td>
      <td className="players-col">{entry.players || "-"}</td>
      <td className="year-col">{entry.year || "-"}</td>
      <td className="maker-col">{entry.manufacturer || "-"}</td>
      <td className="stats-col">
        <div className="compact-stat">
          {entry.romCount ? `${entry.romCount} files` : "-"}
        </div>
        <div className="game-detail">{formatBytes(entry.romSize)}</div>
      </td>
      <td className="media-col">
        <a
          className="icon-button table-link"
          href={getScreenscraperUrl(entry)}
          target="_blank"
          rel="noreferrer"
          title="Open ScreenScraper"
        >
          <ExternalLink aria-hidden="true" />
        </a>
      </td>
    </tr>
  );
}

function compareEntries(left: RomEntry, right: RomEntry, sortKey: SortKey) {
  if (sortKey === "year") {
    return (
      (left.year || "9999").localeCompare(right.year || "9999") ||
      left.title.localeCompare(right.title)
    );
  }

  return (
    left[sortKey].localeCompare(right[sortKey]) ||
    left.title.localeCompare(right.title)
  );
}

function getSampleStatus(
  entry: RomEntry,
  sampleSourceAssets: Map<string, RomAsset>,
  sampleTargetAssets: Map<string, RomAsset>,
) {
  const sampleIds = getRequiredSampleIds(
    entry,
    sampleSourceAssets,
    sampleTargetAssets,
  );
  if (sampleIds.length === 0) {
    return {
      className: "sample-none",
      detail: "",
      label: "None",
      title: "No sample pack is known for this ROM.",
    };
  }

  const present = sampleIds.filter((id) => sampleTargetAssets.has(id));
  if (present.length === sampleIds.length) {
    return {
      className: "sample-present",
      detail: sampleIds.join(", "),
      label: "Ready",
      title: `Sample pack present: ${sampleIds.join(", ")}`,
    };
  }

  const copyable = sampleIds.filter(
    (id) => !sampleTargetAssets.has(id) && sampleSourceAssets.has(id),
  );
  if (copyable.length > 0) {
    return {
      className: "sample-missing",
      detail: copyable.join(", "),
      label: "Missing",
      title: `Sample pack can be copied: ${copyable.join(", ")}`,
    };
  }

  const unavailable = sampleIds.filter((id) => !sampleTargetAssets.has(id));
  return {
    className: "sample-unavailable",
    detail: unavailable.join(", "),
    label: "No source",
    title: `Sample pack missing from source: ${unavailable.join(", ")}`,
  };
}

function getRequiredSampleIds(
  entry: RomEntry,
  sampleSourceAssets: Map<string, RomAsset>,
  sampleTargetAssets: Map<string, RomAsset>,
) {
  const explicitIds = entry.sampleArchiveIds
    .map((id) => id.toLowerCase())
    .filter(Boolean);
  if (explicitIds.length > 0) {
    return [...new Set(explicitIds)];
  }

  const candidateIds = [entry.id, entry.cloneOf, entry.romOf]
    .map((id) => id.toLowerCase())
    .filter(Boolean);
  return [
    ...new Set(
      candidateIds.filter(
        (id) => sampleSourceAssets.has(id) || sampleTargetAssets.has(id),
      ),
    ),
  ];
}

function getVerifiedCounterpartRemovals(
  plan: CounterpartPlanItem[],
  primaryAssets: Map<string, RomAsset>,
  counterpartAssets: Map<string, RomAsset>,
) {
  const removals: Array<{
    asset: RomAsset;
    target: FileSystemDirectoryHandle;
  }> = [];
  const seen = new Set<string>();

  for (const item of plan) {
    if (!item.removeAsset || !item.removeTarget) {
      continue;
    }

    const copiedAssetKey = item.sourceAsset.baseName.toLowerCase();
    const copied =
      item.direction === "primaryToCounterpart"
        ? counterpartAssets.has(copiedAssetKey)
        : primaryAssets.has(copiedAssetKey);
    if (!copied) {
      continue;
    }

    const removeKey =
      `${item.removeTarget.name}:${item.removeAsset.name}`.toLowerCase();
    if (seen.has(removeKey)) {
      continue;
    }

    seen.add(removeKey);
    removals.push({ asset: item.removeAsset, target: item.removeTarget });
  }

  return removals;
}

function sourceLabel(key: SourceKey) {
  return SOURCE_CONFIG.find((source) => source.key === key)?.label || "Source";
}

async function inspectSource(
  key: SourceKey,
  handle: FileSystemHandle,
): Promise<SourceStatus> {
  if (key === "xmlFile") {
    const allowed = await verifyPermission(handle, "read");
    if (!allowed) {
      return {
        detail: "The browser did not grant read permission for this XML file.",
        selectedName: handle.name,
        state: "warning",
      };
    }

    const file = await (handle as FileSystemFileHandle).getFile();
    return {
      detail: file.name.toLowerCase().endsWith(".xml")
        ? `${file.name} selected.`
        : "Selected file is not an XML file.",
      selectedName: file.name,
      state: file.name.toLowerCase().endsWith(".xml") ? "ready" : "warning",
    };
  }

  const mode: FileSystemPermissionMode =
    key === "targetDir" ||
    key === "fbneoTargetDir" ||
    key === "sampleTargetDir" ||
    key === "fbneoSampleTargetDir"
      ? "readwrite"
      : "read";
  const allowed = await verifyPermission(handle, mode);
  if (!allowed) {
    return {
      detail: `The browser did not grant ${mode} permission for this folder.`,
      selectedName: handle.name,
      state: "warning",
    };
  }

  if (key === "fullDir") {
    const source = await resolveRomDirectory(
      handle as FileSystemDirectoryHandle,
      { preferRomsSubfolder: true },
    );
    return {
      detail:
        source.assets.size > 0
          ? formatDirectoryStatus(
              source.assets.size,
              source.usedSubfolder,
              "full set",
            )
          : "No ROM archives found. Choose the full set folder or its roms subfolder.",
      selectedName: source.selectedName,
      state: source.assets.size > 0 ? "ready" : "warning",
    };
  }

  if (key === "fbneoFullDir") {
    const source = await resolveRomDirectory(
      handle as FileSystemDirectoryHandle,
      { preferRomsSubfolder: true },
    );
    return {
      detail:
        source.assets.size > 0
          ? formatDirectoryStatus(
              source.assets.size,
              source.usedSubfolder,
              "FBNeo set",
            )
          : "No FBNeo ROM archives found. Choose the set folder, games folder, or a folder containing games.",
      selectedName: source.selectedName,
      state: source.assets.size > 0 ? "ready" : "warning",
    };
  }

  if (key === "sampleSourceDir") {
    const source = await resolveSampleDirectory(
      handle as FileSystemDirectoryHandle,
      {
        preferSamplesSubfolder: true,
      },
    );
    return {
      detail: formatSampleDirectoryStatus(
        source.assets.size,
        source.usedSubfolder,
        "source",
      ),
      selectedName: source.selectedName,
      state: source.assets.size > 0 ? "ready" : "warning",
    };
  }

  if (key === "sampleTargetDir" || key === "fbneoSampleTargetDir") {
    const target = await resolveSampleDirectory(
      handle as FileSystemDirectoryHandle,
      {
        createSubfolder: true,
        preferSamplesSubfolder: true,
      },
    );
    return {
      detail:
        key === "fbneoSampleTargetDir"
          ? `${formatSampleDirectoryStatus(target.assets.size, target.usedSubfolder, "target")} Use bios\\fbneo\\samples for FBNeo.`
          : formatSampleDirectoryStatus(
              target.assets.size,
              target.usedSubfolder,
              "target",
            ),
      selectedName: target.selectedName,
      state: "ready",
    };
  }

  if (key === "soundtrackSourceDir") {
    const source = await resolveSoundtrackDirectory(
      handle as FileSystemDirectoryHandle,
      {
        preferSoundtrackSubfolder: true,
      },
    );
    return {
      detail: formatSoundtrackDirectoryStatus(
        source.assets.size,
        source.usedSubfolder,
      ),
      selectedName: source.selectedName,
      state: source.assets.size > 0 ? "ready" : "warning",
    };
  }

  const assets = await listRomAssets(handle as FileSystemDirectoryHandle);
  const targetLabel =
    key === "fbneoTargetDir" ? "FBNeo playing set" : "playing set";
  return {
    detail:
      assets.size > 0
        ? `${assets.size.toLocaleString()} ROM item${assets.size === 1 ? "" : "s"} found in the ${targetLabel}.`
        : `No ROMs found yet. This ${targetLabel} folder can still receive copied ROMs.`,
    selectedName: handle.name,
    state: assets.size > 0 ? "ready" : "warning",
  };
}

function formatDirectoryStatus(
  count: number,
  usedSubfolder: boolean,
  label: string,
) {
  const countText = `${count.toLocaleString()} ROM item${count === 1 ? "" : "s"} found`;
  return usedSubfolder
    ? `${countText} in a detected ROM subfolder.`
    : `${countText} in the selected ${label} folder.`;
}

async function resolveSampleSource(
  selectedSampleSource: FileSystemDirectoryHandle | null,
  fullSetDirectory: FileSystemDirectoryHandle,
) {
  const source = selectedSampleSource
    ? await resolveSampleDirectory(selectedSampleSource, {
        preferSamplesSubfolder: true,
      })
    : await resolveSampleDirectory(fullSetDirectory, {
        onlySamplesSubfolder: fullSetDirectory.name.toLowerCase() !== "samples",
        preferSamplesSubfolder: true,
      });

  return {
    ...source,
    available: source.assets.size > 0,
  };
}

async function resolveSampleTarget(
  selectedSampleTarget: FileSystemDirectoryHandle | null,
) {
  if (!selectedSampleTarget) {
    return {
      assets: new Map<string, RomAsset>(),
      available: false,
      directory: null,
      effectiveName: "",
      selectedName: "",
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
    ? await resolveSoundtrackDirectory(selectedSoundtrackSource, {
        preferSoundtrackSubfolder: true,
      })
    : await resolveSoundtrackDirectory(fullSetDirectory, {
        onlySoundtrackSubfolder:
          fullSetDirectory.name.toLowerCase() !== "optional soundtrack samples",
        preferSoundtrackSubfolder: true,
      });

  return {
    ...source,
    available: source.assets.size > 0,
  };
}

function formatSampleDirectoryStatus(
  count: number,
  usedSubfolder: boolean,
  label: "source" | "target",
) {
  const countText = `${count.toLocaleString()} sample pack${count === 1 ? "" : "s"} found`;
  if (label === "target" && usedSubfolder) {
    return `${countText} in the samples subfolder.`;
  }

  if (label === "source" && usedSubfolder) {
    return `${countText} in the samples subfolder.`;
  }

  return `${countText} in the selected sample ${label}.`;
}

function formatSoundtrackDirectoryStatus(
  count: number,
  usedSubfolder: boolean,
) {
  const countText = `${count.toLocaleString()} OST pack${count === 1 ? "" : "s"} found`;
  return usedSubfolder
    ? `${countText} in the optional soundtrack samples subfolder.`
    : `${countText} in the selected OST source.`;
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

  return "Something went wrong.";
}
