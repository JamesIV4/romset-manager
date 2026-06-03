import type { ParsedRom, RomAsset } from './types';

const REGION_MATCHERS = [
  { label: 'World', pattern: /\b(world|international)\b/i },
  { label: 'USA', pattern: /\b(usa|u\.s\.a\.|america|united states)\b/i },
  { label: 'Japan', pattern: /\b(japan|japanese)\b/i },
  { label: 'Europe', pattern: /\b(europe|euro)\b/i },
  { label: 'Asia', pattern: /\b(asia|asian)\b/i },
  { label: 'Korea', pattern: /\b(korea|korean)\b/i },
  { label: 'China', pattern: /\b(china|chinese|hong kong|taiwan)\b/i },
  { label: 'Oceania', pattern: /\b(australia|new zealand|oceania)\b/i },
  { label: 'Brazil', pattern: /\b(brazil|brasil)\b/i },
  { label: 'Spain', pattern: /\b(spain|spanish)\b/i },
  { label: 'France', pattern: /\b(france|french)\b/i },
  { label: 'Germany', pattern: /\b(germany|german)\b/i },
  { label: 'Italy', pattern: /\b(italy|italian)\b/i },
  { label: 'UK', pattern: /\b(uk|united kingdom|britain)\b/i },
];

const ARCHIVE_TITLE_ALIASES: Record<string, string> = {
  '2020bb': '2020 Super Baseball (set 1)',
};

export function parseMameXml(xmlText: string): ParsedRom[] {
  const document = new DOMParser().parseFromString(xmlText, 'application/xml');
  const parserError = document.querySelector('parsererror');
  if (parserError) {
    throw new Error(parserError.textContent?.trim() || 'The XML file could not be parsed.');
  }

  const nodes = Array.from(document.querySelectorAll('machine, game'));
  return nodes
    .map(parseMachine)
    .filter((rom): rom is ParsedRom => Boolean(rom))
    .sort((left, right) => left.title.localeCompare(right.title));
}

export function parseRomXml(xmlText: string, fallbackAssets: Map<string, RomAsset> = new Map()): ParsedRom[] {
  const mameEntries = parseMameXml(xmlText);
  if (mameEntries.length > 0 || fallbackAssets.size === 0) {
    return mameEntries;
  }

  return parseArchiveMetadataXml(xmlText, fallbackAssets);
}

export function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '';
  }

  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function parseMachine(node: Element): ParsedRom | null {
  const id = attr(node, 'name');
  if (!id) {
    return null;
  }

  const title = text(node, 'description') || id;
  const input = node.querySelector(':scope > input') ?? node.querySelector('input');
  const display = node.querySelector(':scope > display, :scope > screen, :scope > video') ?? node.querySelector('display, screen, video');
  const drivers = Array.from(node.querySelectorAll(':scope > driver'));
  const statusDriver = drivers.find((driver) => driver.hasAttribute('status') || driver.hasAttribute('emulation'));
  const romNodes = Array.from(node.querySelectorAll(':scope > rom'));
  const diskNodes = Array.from(node.querySelectorAll(':scope > disk'));
  const diskNames = diskNodes.map((disk) => attr(disk, 'name')).filter(Boolean);
  const chipNodes = Array.from(node.querySelectorAll(':scope > chip'));
  const deviceNodes = Array.from(node.querySelectorAll(':scope > device_ref'));
  const sampleNames = Array.from(node.querySelectorAll(':scope > sample'))
    .map((sample) => attr(sample, 'name'))
    .filter(Boolean);
  const romSize = romNodes.reduce((sum, rom) => sum + Number(attr(rom, 'size') || 0), 0);
  const controls = getControls(input);
  const displaySummary = getDisplay(display);
  const manufacturer = cleanMetadata(text(node, 'manufacturer'));
  const year = cleanMetadata(text(node, 'year'));
  const genre = cleanMetadata(text(node, 'genre'));
  const category = cleanMetadata(text(node, 'category'));
  const players = cleanMetadata(attr(input, 'players'));
  const buttons = cleanMetadata(attr(input, 'buttons'));
  const coins = cleanMetadata(attr(input, 'coins'));
  const cloneOf = attr(node, 'cloneof');
  const romOf = attr(node, 'romof');
  const sampleOf = attr(node, 'sampleof');
  const sampleArchiveIds = sampleOf ? [sampleOf] : sampleNames.length > 0 ? [id] : [];
  const sourceFile = attr(node, 'sourcefile');
  const driverName = sourceFile;
  const driverStatus = getDriverStatus(statusDriver);
  const dumpStatus = getDumpStatus([...romNodes, ...diskNodes]);
  const region = inferRegion(title);
  const isBios = attr(node, 'isbios') === 'yes' || Boolean(node.querySelector(':scope > biosset'));
  const isDevice = attr(node, 'isdevice') === 'yes';
  const isMechanical = attr(node, 'ismechanical') === 'yes';
  const isRunnable = attr(node, 'runnable') !== 'no' && !isBios;

  return {
    id,
    title,
    region,
    year,
    manufacturer,
    players,
    buttons,
    controls,
    coins,
    genre,
    category,
    cloneOf,
    romOf,
    sampleOf,
    sampleArchiveIds,
    sampleNames,
    driverName,
    display: displaySummary,
    driverStatus,
    isBios,
    isDevice,
    isMechanical,
    isRunnable,
    sourceFile,
    chipCount: chipNodes.length,
    deviceCount: deviceNodes.length,
    diskCount: diskNodes.length,
    diskNames,
    dumpStatus,
    romCount: romNodes.length,
    romSize,
    searchText: [
      id,
      title,
      region,
      manufacturer,
      year,
      genre,
      category,
      cloneOf,
      romOf,
      sampleOf,
      sampleArchiveIds.join(' '),
      sampleNames.join(' '),
      driverName,
      sourceFile,
      controls,
      driverStatus,
      dumpStatus,
      diskNames.join(' '),
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase(),
  };
}

function parseArchiveMetadataXml(xmlText: string, assets: Map<string, RomAsset>): ParsedRom[] {
  const document = new DOMParser().parseFromString(xmlText, 'application/xml');
  const parserError = document.querySelector('parsererror');
  if (parserError) {
    throw new Error(parserError.textContent?.trim() || 'The XML file could not be parsed.');
  }

  const collectionTitle = cleanMetadata(text(document.documentElement, 'title'));
  const descriptionHtml = text(document.documentElement, 'description');
  const sections = descriptionHtml ? parseArchiveDescriptionSections(descriptionHtml) : new Map<string, string[]>();
  const allTitles = [...sections.values()].flat();

  return [...assets.entries()]
    .map(([id, asset]) => {
      const folderTitles = asset.folder ? sections.get(asset.folder.toLowerCase()) || [] : [];
      const title = findArchiveTitle(id, folderTitles, true) || findArchiveTitle(id, allTitles, false) || formatIdTitle(asset.baseName);
      return createMetadataBackedEntry(id, asset, title, collectionTitle, asset.folder || '');
    })
    .sort((left, right) => left.title.localeCompare(right.title));
}

function createMetadataBackedEntry(
  id: string,
  asset: RomAsset,
  title: string,
  collectionTitle: string,
  folder: string,
): ParsedRom {
  return {
    id,
    title,
    region: inferRegion(title),
    year: '',
    manufacturer: '',
    players: '',
    buttons: '',
    controls: '',
    coins: '',
    genre: '',
    category: [collectionTitle, folder].filter(Boolean).join(' / '),
    cloneOf: '',
    romOf: '',
    sampleOf: '',
    sampleArchiveIds: [],
    sampleNames: [],
    driverName: '',
    display: '',
    driverStatus: 'archive metadata',
    isBios: id === 'neogeo',
    isDevice: false,
    isMechanical: false,
    isRunnable: id !== 'neogeo',
    sourceFile: '',
    chipCount: 0,
    deviceCount: 0,
    diskCount: 0,
    diskNames: [],
    dumpStatus: '',
    romCount: 1,
    romSize: asset.size ?? 0,
    searchText: [id, title, asset.name, asset.relativePath, collectionTitle, folder].filter(Boolean).join(' ').toLowerCase(),
  };
}

function parseArchiveDescriptionSections(descriptionHtml: string) {
  const htmlDocument = new DOMParser().parseFromString(descriptionHtml, 'text/html');
  const sections = new Map<string, string[]>();
  let currentFolder = '';
  let inGameList = false;

  for (const node of Array.from(htmlDocument.body.querySelectorAll('div, li'))) {
    const value = cleanMetadata(node.textContent || '');
    if (!value) {
      continue;
    }

    if (/^game list$/i.test(value)) {
      inGameList = true;
      continue;
    }

    if (!inGameList) {
      continue;
    }

    if (node.querySelector('div, li')) {
      continue;
    }

    const folder = getArchiveSectionFolder(value);
    if (folder) {
      currentFolder = folder;
      if (!sections.has(currentFolder)) {
        sections.set(currentFolder, []);
      }
      continue;
    }

    if (!currentFolder || isArchiveHeading(value)) {
      continue;
    }

    sections.get(currentFolder)!.push(cleanArchiveGameTitle(value));
  }

  return sections;
}

function findArchiveTitle(id: string, titles: string[], allowLooseMatch: boolean) {
  const aliasedTitle = ARCHIVE_TITLE_ALIASES[id.toLowerCase()];
  if (aliasedTitle && titles.some((title) => normalizeComparable(title) === normalizeComparable(aliasedTitle))) {
    return aliasedTitle;
  }

  const normalizedId = normalizeComparable(id);
  const exact = titles.find((title) => getTitleKeys(title).has(normalizedId));
  if (exact) {
    return exact;
  }

  const prefix = titles.find((title) => {
    const titleKeys = getTitleKeys(title);
    return [...titleKeys].some((titleKey) => normalizedId.length >= 3 && titleKey.startsWith(normalizedId));
  });
  if (prefix) {
    return prefix;
  }

  const idConsonants = consonantKey(normalizedId);
  const consonantMatch = titles.find((title) => {
    return [...getTitleKeys(title)].some((titleKey) => {
      const titleConsonants = consonantKey(titleKey);
      return idConsonants.length >= 4 && titleConsonants.startsWith(idConsonants);
    });
  });
  if (consonantMatch) {
    return consonantMatch;
  }

  return allowLooseMatch
    ? titles.find((title) => [...getTitleKeys(title)].some((titleKey) => isOrderedSubsequence(normalizedId, titleKey)))
    : undefined;
}

function formatIdTitle(id: string) {
  return id.replace(/[_-]+/g, ' ');
}

function isArchiveHeading(line: string) {
  return /^(\*|about|install|game list|.+ folder|\d+\s+.+ games|samples are|all games|this set|most of|copy the|make sure|scape your|[\d\s]+total games|this is a|the games are|the only exception|there are a few|some of the later)/i.test(
    line,
  );
}

function getArchiveSectionFolder(line: string) {
  const match = line.match(/\(([^)]+)\s+folder\)/i);
  if (match) {
    return match[1].trim().toLowerCase();
  }

  if (/additional a[cr]+cade games/i.test(line)) {
    return 'fbneo';
  }

  return '';
}

function cleanArchiveGameTitle(value: string) {
  return value.replace(/^\d{4}\s+/, '').replace(/\s+\*note.+$/i, '').trim();
}

function normalizeComparable(value: string) {
  return expandNumberWords(value).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function expandNumberWords(value: string) {
  return value
    .replace(/\bthree\b/gi, '3')
    .replace(/\btwo\b/gi, '2')
    .replace(/\bfour\b/gi, '4')
    .replace(/\bii\b/gi, '2')
    .replace(/\biii\b/gi, '3')
    .replace(/\biv\b/gi, '4');
}

function getTitleKeys(title: string) {
  const words = getComparableWords(title);
  const keys = new Set<string>([normalizeComparable(title)]);

  if (words.length > 1) {
    const firstWord = words[0]!;
    keys.add(normalizeComparable([firstWord[0], ...words.slice(1)].join(' ')));
    keys.add(normalizeComparable([firstWord, ...words.slice(1).map((word) => word[0])].join(' ')));
    keys.add(normalizeComparable(words.map((word) => word[0]).join(' ')));
  }

  return keys;
}

function getComparableWords(value: string) {
  return expandNumberWords(value)
    .toLowerCase()
    .match(/[a-z0-9]+/g) || [];
}

function consonantKey(value: string) {
  return value.replace(/[aeiou]/g, '');
}

function isOrderedSubsequence(needle: string, haystack: string) {
  if (needle.length < 4 || haystack.length < needle.length) {
    return false;
  }

  let index = 0;
  for (const char of haystack) {
    if (char === needle[index]) {
      index += 1;
      if (index === needle.length) {
        return true;
      }
    }
  }

  return false;
}

function text(node: Element, selector: string) {
  return cleanMetadata(node.querySelector(`:scope > ${selector}`)?.textContent || '');
}

function attr(node: Element | null | undefined, name: string) {
  return cleanMetadata(node?.getAttribute(name) || '');
}

function cleanMetadata(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function inferRegion(title: string) {
  const parenthetical = Array.from(title.matchAll(/\(([^)]+)\)/g)).map((match) => match[1]);
  const haystacks = parenthetical.length > 0 ? parenthetical : [title];
  const found = new Set<string>();

  for (const haystack of haystacks) {
    for (const region of REGION_MATCHERS) {
      if (region.pattern.test(haystack)) {
        found.add(region.label);
      }
    }
  }

  if (found.size === 0) {
    return 'Unknown';
  }

  return Array.from(found).join(' / ');
}

function getControls(input: Element | null) {
  if (!input) {
    return '';
  }

  const controlAttribute = attr(input, 'control');
  const controlNodes = Array.from(input.querySelectorAll(':scope > control'))
    .map((control) => attr(control, 'type'))
    .filter(Boolean);

  return [...new Set([controlAttribute, ...controlNodes].filter(Boolean))].join(', ');
}

function getDisplay(display: Element | null) {
  if (!display) {
    return '';
  }

  const type = attr(display, 'type');
  const screen = attr(display, 'screen');
  const orientation = attr(display, 'orientation');
  const rotate = attr(display, 'rotate');
  const width = attr(display, 'width');
  const height = attr(display, 'height');
  const refresh = attr(display, 'refresh');
  const size = width && height ? `${width}x${height}` : '';
  const rotation = rotate ? `${rotate} deg` : '';
  const refreshNumber = Number(refresh);
  const rate = refresh && Number.isFinite(refreshNumber) ? `${refreshNumber.toFixed(0)} Hz` : refresh;

  return [type || screen, orientation, size, rotation || rate].filter(Boolean).join(' ');
}

function getDriverStatus(driver: Element | undefined) {
  if (!driver) {
    return '';
  }

  const fields = [
    ['status', attr(driver, 'status')],
    ['emulation', attr(driver, 'emulation')],
    ['savestate', attr(driver, 'savestate')],
    ['cocktail', attr(driver, 'cocktail')],
    ['protection', attr(driver, 'protection')],
    ['color', attr(driver, 'color')],
    ['sound', attr(driver, 'sound')],
    ['graphics', attr(driver, 'graphic')],
  ];

  return fields
    .filter(([, value]) => value)
    .map(([label, value]) => `${label}: ${value}`)
    .join(', ');
}

function getDumpStatus(nodes: Element[]) {
  const statuses = nodes.map((node) => attr(node, 'status')).filter(Boolean);
  if (statuses.length === 0) {
    return '';
  }

  return [...new Set(statuses)].join(', ');
}
