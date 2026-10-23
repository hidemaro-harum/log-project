import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_PHOTO_EDIT,
  drawPhotoEdit,
  getPhotoEditGeometry,
  type PhotoEdit,
} from "./photo-edit.ts";

function edit(overrides: Partial<PhotoEdit> = {}): PhotoEdit {
  return { ...DEFAULT_PHOTO_EDIT, ...overrides };
}

test("original ratio keeps the whole image after a 90 or 270 degree turn", () => {
  for (const rotation of [90, 270, -90, 450]) {
    assert.deepEqual(getPhotoEditGeometry(4000, 3000, edit({ rotation })), {
      rotatedWidth: 3000,
      rotatedHeight: 4000,
      crop: { x: 0, y: 0, width: 3000, height: 4000 },
    });
  }
  assert.deepEqual(getPhotoEditGeometry(4000, 3000, edit({ rotation: 180 })).crop, {
    x: 0, y: 0, width: 4000, height: 3000,
  });
});

test("preset ratios use the largest centered crop", () => {
  assert.deepEqual(getPhotoEditGeometry(4000, 3000, edit({ aspect: "square" })).crop, {
    x: 500, y: 0, width: 3000, height: 3000,
  });
  assert.deepEqual(getPhotoEditGeometry(4000, 3000, edit({ aspect: "portrait" })).crop, {
    x: 875, y: 0, width: 2250, height: 3000,
  });
  assert.deepEqual(getPhotoEditGeometry(3000, 4000, edit({ aspect: "landscape" })).crop, {
    x: 0, y: 875, width: 3000, height: 2250,
  });
});

test("zoom and edge positioning remain inside the rotated image", () => {
  const geometry = getPhotoEditGeometry(4000, 3000, edit({
    rotation: 90, aspect: "landscape", zoom: 2, x: 1, y: 1,
  }));
  assert.deepEqual(geometry.crop, { x: 1500, y: 2875, width: 1500, height: 1125 });
  assert.equal(geometry.crop.x + geometry.crop.width, geometry.rotatedWidth);
  assert.equal(geometry.crop.y + geometry.crop.height, geometry.rotatedHeight);
  assert.deepEqual(getPhotoEditGeometry(6000, 3000, edit({
    aspect: "square", zoom: 99, x: -2, y: 2,
  })).crop, { x: 0, y: 2000, width: 1000, height: 1000 });
  assert.deepEqual(getPhotoEditGeometry(6000, 3000, edit({ zoom: 0 })).crop, {
    x: 0, y: 0, width: 6000, height: 3000,
  });
});

test("invalid dimensions and nonfinite edits fail before drawing", () => {
  for (const size of [0, -1, 0.5, Number.MIN_VALUE, NaN, Infinity, Number.MAX_VALUE]) {
    assert.throws(() => getPhotoEditGeometry(size, 3000, edit()), /画像サイズ/);
    assert.throws(() => getPhotoEditGeometry(4000, size, edit()), /画像サイズ/);
  }
  for (const key of ["rotation", "zoom", "x", "y"] as const) {
    for (const value of [NaN, Infinity, -Infinity]) {
      assert.throws(() => getPhotoEditGeometry(4000, 3000, edit({ [key]: value })));
    }
  }
  assert.throws(() => getPhotoEditGeometry(4000, 3000, edit({ rotation: 45 })), /90度/);
  assert.throws(() => getPhotoEditGeometry(4000, 3000, edit({ aspect: "bad" as PhotoEdit["aspect"] })), /比率/);
});

test("drawing bounds canvas memory and applies the crop in rotated coordinates", () => {
  const calls: { name: string; args: unknown[] }[] = [];
  const context = {
    scale: (...args: number[]) => calls.push({ name: "scale", args }),
    translate: (...args: number[]) => calls.push({ name: "translate", args }),
    rotate: (...args: number[]) => calls.push({ name: "rotate", args }),
    drawImage: (...args: unknown[]) => calls.push({ name: "drawImage", args }),
  };
  const canvas = { width: 0, height: 0, getContext: () => context } as unknown as HTMLCanvasElement;
  const image = {} as CanvasImageSource;
  drawPhotoEdit(canvas, image, 12000, 9000, edit({ rotation: 90, aspect: "portrait", x: 1, zoom: 2 }));
  assert.equal(canvas.width, 1536);
  assert.equal(canvas.height, 2048);
  assert.deepEqual(calls, [
    { name: "scale", args: [1536 / 4500, 2048 / 6000] },
    { name: "translate", args: [-4500, -3000] },
    { name: "translate", args: [4500, 6000] },
    { name: "rotate", args: [Math.PI / 2] },
    { name: "drawImage", args: [image, -6000, -4500, 12000, 9000] },
  ]);
  drawPhotoEdit(canvas, image, 80, 40, edit());
  assert.equal(canvas.width, 80);
  assert.equal(canvas.height, 40);
});
