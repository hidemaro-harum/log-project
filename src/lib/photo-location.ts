export type PhotoCoordinates = {
  latitude: number;
  longitude: number;
};

type PhotoLocationFile = {
  arrayBuffer(): Promise<ArrayBuffer>;
};

type IfdEntry = {
  count: number;
  offset: number;
  tag: number;
  type: number;
};

type BmffBox = {
  contentStart: number;
  end: number;
  headerSize: number;
  start: number;
  type: string;
};

type ItemLocation = {
  constructionMethod: number;
  extents: { length: number; offset: number }[];
  itemId: number;
};

const JPEG_SOI = 0xffd8;
const APP1_MARKER = 0xe1;
const EXIF_HEADER = "Exif\0\0";
const TIFF_MAGIC = 42;
const GPS_IFD_TAG = 0x8825;
const GPS_LATITUDE_REF_TAG = 1;
const GPS_LATITUDE_TAG = 2;
const GPS_LONGITUDE_REF_TAG = 3;
const GPS_LONGITUDE_TAG = 4;
const HEIF_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heif", "mif1", "msf1"]);

export async function getPhotoCoordinates(file: PhotoLocationFile) {
  return getPhotoCoordinatesFromArrayBuffer(await file.arrayBuffer());
}

export function getPhotoCoordinatesFromArrayBuffer(buffer: ArrayBuffer): PhotoCoordinates | null {
  const view = new DataView(buffer);
  if (view.byteLength < 4) return null;

  if (view.getUint16(0, false) === JPEG_SOI) return parseJpegExifGps(view);
  return parseHeicExifGps(view);
}

function parseJpegExifGps(view: DataView) {
  let offset = 2;
  while (offset + 4 <= view.byteLength) {
    if (view.getUint8(offset) !== 0xff) return null;

    const marker = view.getUint8(offset + 1);
    const segmentLength = view.getUint16(offset + 2, false);
    const segmentStart = offset + 4;
    const segmentEnd = offset + 2 + segmentLength;
    if (segmentLength < 2 || segmentEnd > view.byteLength) return null;

    if (marker === APP1_MARKER && readAscii(view, segmentStart, EXIF_HEADER.length) === EXIF_HEADER) {
      return parseTiffGps(view, segmentStart + EXIF_HEADER.length, segmentEnd);
    }

    offset = segmentEnd;
  }

  return null;
}

function parseHeicExifGps(view: DataView): PhotoCoordinates | null {
  if (!isHeifLikeFile(view)) return null;

  const metaBoxes = findMetaBoxes(view, 0, view.byteLength);
  for (const metaBox of metaBoxes) {
    const gps = parseMetaBoxExifGps(view, metaBox);
    if (gps) return gps;
  }

  return null;
}

function parseMetaBoxExifGps(view: DataView, metaBox: BmffBox): PhotoCoordinates | null {
  const childrenStart = metaBox.contentStart + 4;
  if (childrenStart > metaBox.end) return null;

  let exifItemIds = new Set<number>();
  let itemLocations = new Map<number, ItemLocation>();

  for (const child of readBoxes(view, childrenStart, metaBox.end)) {
    if (child.type === "iinf") exifItemIds = parseItemInfoBox(view, child);
    if (child.type === "iloc") itemLocations = parseItemLocationBox(view, child);
  }

  for (const itemId of exifItemIds) {
    const location = itemLocations.get(itemId);
    if (!location || location.constructionMethod !== 0) continue;

    for (const extent of location.extents) {
      const gps = parseExifExtentGps(view, extent.offset, extent.length);
      if (gps) return gps;
    }
  }

  return null;
}

function parseItemInfoBox(view: DataView, box: BmffBox) {
  const ids = new Set<number>();
  if (box.contentStart + 6 > box.end) return ids;

  const version = view.getUint8(box.contentStart);
  let offset = box.contentStart + 4;
  const entryCount = version === 0 ? view.getUint16(offset, false) : view.getUint32(offset, false);
  offset += version === 0 ? 2 : 4;

  for (let index = 0; index < entryCount && offset + 8 <= box.end; index += 1) {
    const entry = readBox(view, offset, box.end);
    if (!entry) break;
    if (entry.type === "infe") {
      const itemId = parseItemInfoEntry(view, entry);
      if (itemId !== null) ids.add(itemId);
    }
    offset = entry.end;
  }

  return ids;
}

function parseItemInfoEntry(view: DataView, box: BmffBox) {
  if (box.contentStart + 12 > box.end) return null;

  const version = view.getUint8(box.contentStart);
  if (version < 2) return null;

  let offset = box.contentStart + 4;
  const itemId = version === 2 ? view.getUint16(offset, false) : view.getUint32(offset, false);
  offset += version === 2 ? 2 : 4;
  offset += 2;

  const itemType = readAscii(view, offset, 4);
  return itemType === "Exif" ? itemId : null;
}

function parseItemLocationBox(view: DataView, box: BmffBox) {
  const locations = new Map<number, ItemLocation>();
  if (box.contentStart + 8 > box.end) return locations;

  const version = view.getUint8(box.contentStart);
  let offset = box.contentStart + 4;
  const offsetSize = view.getUint8(offset) >> 4;
  const lengthSize = view.getUint8(offset) & 0x0f;
  offset += 1;
  const baseOffsetSize = view.getUint8(offset) >> 4;
  const indexSize = version === 1 || version === 2 ? view.getUint8(offset) & 0x0f : 0;
  offset += 1;

  const itemCount = version < 2 ? view.getUint16(offset, false) : view.getUint32(offset, false);
  offset += version < 2 ? 2 : 4;

  for (let index = 0; index < itemCount && offset < box.end; index += 1) {
    const itemId = version < 2 ? view.getUint16(offset, false) : view.getUint32(offset, false);
    offset += version < 2 ? 2 : 4;

    let constructionMethod = 0;
    if (version === 1 || version === 2) {
      constructionMethod = view.getUint16(offset, false) & 0x0fff;
      offset += 2;
    }

    offset += 2;
    const baseOffset = readSizedInteger(view, offset, baseOffsetSize, box.end);
    if (baseOffset === null) break;
    offset += baseOffsetSize;

    const extentCount = view.getUint16(offset, false);
    offset += 2;
    const extents: { length: number; offset: number }[] = [];

    for (let extentIndex = 0; extentIndex < extentCount; extentIndex += 1) {
      if (indexSize > 0) offset += indexSize;

      const extentOffset = readSizedInteger(view, offset, offsetSize, box.end);
      if (extentOffset === null) break;
      offset += offsetSize;

      const extentLength = readSizedInteger(view, offset, lengthSize, box.end);
      if (extentLength === null) break;
      offset += lengthSize;

      extents.push({ offset: baseOffset + extentOffset, length: extentLength });
    }

    locations.set(itemId, { constructionMethod, extents, itemId });
  }

  return locations;
}

function parseExifExtentGps(view: DataView, offset: number, length: number) {
  const end = offset + length;
  if (offset < 0 || length <= 0 || end > view.byteLength) return null;

  const tiffOffset = findTiffOffsetInExifItem(view, offset, end);
  return tiffOffset === null ? null : parseTiffGps(view, tiffOffset, end);
}

function findTiffOffsetInExifItem(view: DataView, offset: number, end: number) {
  if (readAscii(view, offset, EXIF_HEADER.length) === EXIF_HEADER) return offset + EXIF_HEADER.length;

  if (offset + 8 <= end) {
    const relativeTiffOffset = view.getUint32(offset, false);
    for (const candidate of [offset + 4 + relativeTiffOffset, offset + relativeTiffOffset]) {
      if (isTiffHeader(view, candidate, end)) return candidate;
    }
  }

  const scanEnd = Math.min(offset + 32, end - 4);
  for (let candidate = offset; candidate <= scanEnd; candidate += 1) {
    if (isTiffHeader(view, candidate, end)) return candidate;
  }

  return null;
}

function parseTiffGps(view: DataView, tiffOffset: number, exifEnd: number): PhotoCoordinates | null {
  if (tiffOffset + 8 > exifEnd) return null;

  const byteOrder = readAscii(view, tiffOffset, 2);
  const littleEndian = byteOrder === "II";
  if (!littleEndian && byteOrder !== "MM") return null;
  if (view.getUint16(tiffOffset + 2, littleEndian) !== TIFF_MAGIC) return null;

  const firstIfdOffset = tiffOffset + view.getUint32(tiffOffset + 4, littleEndian);
  const gpsIfdEntry = findIfdEntry(view, firstIfdOffset, GPS_IFD_TAG, littleEndian, exifEnd);
  if (!gpsIfdEntry) return null;

  const gpsIfdOffset = tiffOffset + view.getUint32(gpsIfdEntry.offset + 8, littleEndian);
  const latitudeRef = readGpsRef(view, gpsIfdOffset, GPS_LATITUDE_REF_TAG, littleEndian, tiffOffset, exifEnd);
  const latitude = readGpsCoordinate(view, gpsIfdOffset, GPS_LATITUDE_TAG, littleEndian, tiffOffset, exifEnd);
  const longitudeRef = readGpsRef(view, gpsIfdOffset, GPS_LONGITUDE_REF_TAG, littleEndian, tiffOffset, exifEnd);
  const longitude = readGpsCoordinate(view, gpsIfdOffset, GPS_LONGITUDE_TAG, littleEndian, tiffOffset, exifEnd);

  if (!latitudeRef || latitude === null || !longitudeRef || longitude === null) return null;

  return {
    latitude: applyCoordinateRef(latitude, latitudeRef, "S"),
    longitude: applyCoordinateRef(longitude, longitudeRef, "W"),
  };
}

function isHeifLikeFile(view: DataView) {
  const ftyp = readBox(view, 0, view.byteLength);
  if (!ftyp || ftyp.type !== "ftyp" || ftyp.contentStart + 8 > ftyp.end) return false;

  if (HEIF_BRANDS.has(readAscii(view, ftyp.contentStart, 4))) return true;
  for (let offset = ftyp.contentStart + 8; offset + 4 <= ftyp.end; offset += 4) {
    if (HEIF_BRANDS.has(readAscii(view, offset, 4))) return true;
  }

  return false;
}

function findMetaBoxes(view: DataView, start: number, end: number) {
  const metaBoxes: BmffBox[] = [];
  for (const box of readBoxes(view, start, end)) {
    if (box.type === "meta") metaBoxes.push(box);
    if (box.type === "moov") metaBoxes.push(...findMetaBoxes(view, box.contentStart, box.end));
  }
  return metaBoxes;
}

function readBoxes(view: DataView, start: number, end: number) {
  const boxes: BmffBox[] = [];
  let offset = start;

  while (offset + 8 <= end) {
    const box = readBox(view, offset, end);
    if (!box) break;
    boxes.push(box);
    offset = box.end;
  }

  return boxes;
}

function readBox(view: DataView, offset: number, limit: number): BmffBox | null {
  if (offset + 8 > limit) return null;

  const size32 = view.getUint32(offset, false);
  const type = readAscii(view, offset + 4, 4);
  let headerSize = 8;
  let size = size32;

  if (size32 === 1) {
    if (offset + 16 > limit) return null;
    const size64 = view.getBigUint64(offset + 8, false);
    if (size64 > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    size = Number(size64);
    headerSize = 16;
  } else if (size32 === 0) {
    size = limit - offset;
  }

  const end = offset + size;
  if (size < headerSize || end > limit) return null;

  return {
    contentStart: offset + headerSize,
    end,
    headerSize,
    start: offset,
    type,
  };
}

function readSizedInteger(view: DataView, offset: number, size: number, limit: number) {
  if (size === 0) return 0;
  if (offset + size > limit) return null;
  if (size === 1) return view.getUint8(offset);
  if (size === 2) return view.getUint16(offset, false);
  if (size === 4) return view.getUint32(offset, false);
  if (size === 8) {
    const value = view.getBigUint64(offset, false);
    return value > BigInt(Number.MAX_SAFE_INTEGER) ? null : Number(value);
  }
  return null;
}

function isTiffHeader(view: DataView, offset: number, end: number) {
  if (offset + 4 > end) return false;
  const byteOrder = readAscii(view, offset, 2);
  const littleEndian = byteOrder === "II";
  if (!littleEndian && byteOrder !== "MM") return false;
  return view.getUint16(offset + 2, littleEndian) === TIFF_MAGIC;
}

function findIfdEntry(
  view: DataView,
  ifdOffset: number,
  tag: number,
  littleEndian: boolean,
  exifEnd: number,
): IfdEntry | null {
  if (ifdOffset + 2 > exifEnd) return null;

  const entryCount = view.getUint16(ifdOffset, littleEndian);
  for (let index = 0; index < entryCount; index += 1) {
    const offset = ifdOffset + 2 + index * 12;
    if (offset + 12 > exifEnd) return null;

    const entry = {
      count: view.getUint32(offset + 4, littleEndian),
      offset,
      tag: view.getUint16(offset, littleEndian),
      type: view.getUint16(offset + 2, littleEndian),
    };
    if (entry.tag === tag) return entry;
  }

  return null;
}

function readGpsRef(
  view: DataView,
  gpsIfdOffset: number,
  tag: number,
  littleEndian: boolean,
  tiffOffset: number,
  exifEnd: number,
) {
  const entry = findIfdEntry(view, gpsIfdOffset, tag, littleEndian, exifEnd);
  if (!entry || entry.type !== 2 || entry.count < 1) return null;

  const valueOffset = entry.count <= 4 ? entry.offset + 8 : tiffOffset + view.getUint32(entry.offset + 8, littleEndian);
  if (valueOffset >= exifEnd) return null;

  return String.fromCharCode(view.getUint8(valueOffset));
}

function readGpsCoordinate(
  view: DataView,
  gpsIfdOffset: number,
  tag: number,
  littleEndian: boolean,
  tiffOffset: number,
  exifEnd: number,
) {
  const entry = findIfdEntry(view, gpsIfdOffset, tag, littleEndian, exifEnd);
  if (!entry || entry.type !== 5 || entry.count !== 3) return null;

  const valueOffset = tiffOffset + view.getUint32(entry.offset + 8, littleEndian);
  if (valueOffset + 24 > exifEnd) return null;

  const [degrees, minutes, seconds] = [0, 1, 2].map((index) => {
    const rationalOffset = valueOffset + index * 8;
    const numerator = view.getUint32(rationalOffset, littleEndian);
    const denominator = view.getUint32(rationalOffset + 4, littleEndian);
    return denominator ? numerator / denominator : null;
  });

  if (degrees === null || minutes === null || seconds === null) return null;
  return degrees + minutes / 60 + seconds / 3600;
}

function applyCoordinateRef(value: number, ref: string, negativeRef: string) {
  return ref.toUpperCase() === negativeRef ? -value : value;
}

function readAscii(view: DataView, offset: number, length: number) {
  if (offset + length > view.byteLength) return "";

  let value = "";
  for (let index = 0; index < length; index += 1) {
    value += String.fromCharCode(view.getUint8(offset + index));
  }
  return value;
}
