import test from "node:test";
import assert from "node:assert/strict";
import { getPhotoCoordinatesFromArrayBuffer } from "./photo-location.ts";

test("extracts GPS coordinates from JPEG EXIF metadata", () => {
  const jpeg = createExifGpsJpeg({
    latitudeRef: "N",
    latitude: [35, 39, 30],
    longitudeRef: "E",
    longitude: [139, 42, 15],
  });

  assertCoordinates(getPhotoCoordinatesFromArrayBuffer(jpeg.buffer as ArrayBuffer), {
    latitude: 35.65833333333333,
    longitude: 139.70416666666668,
  });
});

test("extracts GPS coordinates from HEIC EXIF item metadata", () => {
  const heic = createExifGpsHeic({
    latitudeRef: "N",
    latitude: [35, 39, 30],
    longitudeRef: "E",
    longitude: [139, 42, 15],
  });

  assertCoordinates(getPhotoCoordinatesFromArrayBuffer(heic.buffer as ArrayBuffer), {
    latitude: 35.65833333333333,
    longitude: 139.70416666666668,
  });
});

test("applies south and west coordinate refs as negative values", () => {
  const jpeg = createExifGpsJpeg({
    latitudeRef: "S",
    latitude: [12, 30, 0],
    longitudeRef: "W",
    longitude: [77, 15, 0],
  });

  assertCoordinates(getPhotoCoordinatesFromArrayBuffer(jpeg.buffer as ArrayBuffer), {
    latitude: -12.5,
    longitude: -77.25,
  });
});

test("returns null when JPEG has no EXIF GPS metadata", () => {
  const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]);

  assert.equal(getPhotoCoordinatesFromArrayBuffer(jpeg.buffer as ArrayBuffer), null);
});

function createExifGpsJpeg({
  latitude,
  latitudeRef,
  longitude,
  longitudeRef,
}: {
  latitude: [number, number, number];
  latitudeRef: "N" | "S";
  longitude: [number, number, number];
  longitudeRef: "E" | "W";
}) {
  const exifPayload = concatBytes(
    asciiBytes("Exif\0\0"),
    createExifGpsTiff({ latitude, latitudeRef, longitude, longitudeRef }),
  );
  const segmentLength = exifPayload.length + 2;
  return Uint8Array.from([
    0xff,
    0xd8,
    0xff,
    0xe1,
    segmentLength >> 8,
    segmentLength & 0xff,
    ...exifPayload,
    0xff,
    0xd9,
  ]);
}

function createExifGpsHeic({
  latitude,
  latitudeRef,
  longitude,
  longitudeRef,
}: {
  latitude: [number, number, number];
  latitudeRef: "N" | "S";
  longitude: [number, number, number];
  longitudeRef: "E" | "W";
}) {
  const exifItem = concatBytes(
    uint32BE(0),
    createExifGpsTiff({ latitude, latitudeRef, longitude, longitudeRef }),
  );
  const ftyp = box("ftyp", concatBytes(asciiBytes("heic"), uint32BE(0), asciiBytes("heic"), asciiBytes("mif1")));
  let meta = createHeicMetaBox(0, exifItem.length);
  const exifOffset = ftyp.length + meta.length + 8;
  meta = createHeicMetaBox(exifOffset, exifItem.length);

  return concatBytes(ftyp, meta, box("mdat", exifItem));
}

function createExifGpsTiff({
  latitude,
  latitudeRef,
  longitude,
  longitudeRef,
}: {
  latitude: [number, number, number];
  latitudeRef: "N" | "S";
  longitude: [number, number, number];
  longitudeRef: "E" | "W";
}) {
  const exifPayload = new Uint8Array(138);
  let offset = 0;

  const tiffOffset = offset;
  writeAscii(exifPayload, offset, "II");
  offset += 2;
  writeUint16(exifPayload, offset, 42);
  offset += 2;
  writeUint32(exifPayload, offset, 8);
  offset += 4;

  const ifd0Offset = tiffOffset + 8;
  writeUint16(exifPayload, ifd0Offset, 1);
  writeIfdEntry(exifPayload, ifd0Offset + 2, 0x8825, 4, 1, 26);
  writeUint32(exifPayload, ifd0Offset + 14, 0);

  const gpsIfdOffset = tiffOffset + 26;
  writeUint16(exifPayload, gpsIfdOffset, 4);
  writeIfdEntry(exifPayload, gpsIfdOffset + 2, 1, 2, 2, charCode(latitudeRef));
  writeIfdEntry(exifPayload, gpsIfdOffset + 14, 2, 5, 3, 80);
  writeIfdEntry(exifPayload, gpsIfdOffset + 26, 3, 2, 2, charCode(longitudeRef));
  writeIfdEntry(exifPayload, gpsIfdOffset + 38, 4, 5, 3, 104);
  writeUint32(exifPayload, gpsIfdOffset + 50, 0);

  writeRationals(exifPayload, tiffOffset + 80, latitude);
  writeRationals(exifPayload, tiffOffset + 104, longitude);

  return exifPayload;
}

function createHeicMetaBox(exifOffset: number, exifLength: number) {
  const itemId = 1;
  const infe = box(
    "infe",
    concatBytes(uint32BE(0x02000000), uint16BE(itemId), uint16BE(0), asciiBytes("Exif"), Uint8Array.of(0)),
  );
  const iinf = box("iinf", concatBytes(uint32BE(0), uint16BE(1), infe));
  const iloc = box(
    "iloc",
    concatBytes(
      uint32BE(0),
      Uint8Array.of(0x44, 0x40),
      uint16BE(1),
      uint16BE(itemId),
      uint16BE(0),
      uint32BE(0),
      uint16BE(1),
      uint32BE(exifOffset),
      uint32BE(exifLength),
    ),
  );

  return box("meta", concatBytes(uint32BE(0), iinf, iloc));
}

function box(type: string, payload: Uint8Array) {
  return concatBytes(uint32BE(payload.length + 8), asciiBytes(type), payload);
}

function writeIfdEntry(
  buffer: Uint8Array,
  offset: number,
  tag: number,
  type: number,
  count: number,
  value: number,
) {
  writeUint16(buffer, offset, tag);
  writeUint16(buffer, offset + 2, type);
  writeUint32(buffer, offset + 4, count);
  writeUint32(buffer, offset + 8, value);
}

function writeRationals(buffer: Uint8Array, offset: number, values: [number, number, number]) {
  values.forEach((value, index) => {
    writeUint32(buffer, offset + index * 8, value);
    writeUint32(buffer, offset + index * 8 + 4, 1);
  });
}

function writeAscii(buffer: Uint8Array, offset: number, value: string) {
  for (let index = 0; index < value.length; index += 1) {
    buffer[offset + index] = value.charCodeAt(index);
  }
}

function asciiBytes(value: string) {
  return Uint8Array.from([...value].map((character) => character.charCodeAt(0)));
}

function concatBytes(...chunks: Uint8Array[]) {
  const bytes = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

function writeUint16(buffer: Uint8Array, offset: number, value: number) {
  buffer[offset] = value & 0xff;
  buffer[offset + 1] = (value >> 8) & 0xff;
}

function uint16BE(value: number) {
  return Uint8Array.of((value >> 8) & 0xff, value & 0xff);
}

function writeUint32(buffer: Uint8Array, offset: number, value: number) {
  buffer[offset] = value & 0xff;
  buffer[offset + 1] = (value >> 8) & 0xff;
  buffer[offset + 2] = (value >> 16) & 0xff;
  buffer[offset + 3] = (value >> 24) & 0xff;
}

function uint32BE(value: number) {
  return Uint8Array.of((value >> 24) & 0xff, (value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff);
}

function charCode(value: string) {
  return value.charCodeAt(0);
}

function assertCoordinates(
  actual: { latitude: number; longitude: number } | null,
  expected: { latitude: number; longitude: number },
) {
  assert.ok(actual);
  assert.ok(Math.abs(actual.latitude - expected.latitude) < 0.0000001);
  assert.ok(Math.abs(actual.longitude - expected.longitude) < 0.0000001);
}
