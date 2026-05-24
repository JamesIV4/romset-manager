import type { ParsedRom } from './types';

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
  const nameDriver = drivers.find((driver) => !driver.hasAttribute('status') && driver.textContent?.trim());
  const romNodes = Array.from(node.querySelectorAll(':scope > rom'));
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
  const driverName = cleanMetadata(nameDriver?.textContent || '');
  const driverStatus = cleanMetadata(attr(statusDriver, 'status') || attr(statusDriver, 'emulation'));
  const region = inferRegion(title);
  const isBios = attr(node, 'isbios') === 'yes' || Boolean(node.querySelector(':scope > biosset'));
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
    isRunnable,
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
      controls,
      driverStatus,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase(),
  };
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
