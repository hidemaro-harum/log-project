import test from "node:test";
import assert from "node:assert/strict";
import {
  getContainedImageSize,
  getOptimizedPhotoName,
  getOptimizedStoragePath,
  isOptimizedStoragePath,
} from "./photo-optimization.ts";

test("scales landscape images down to the configured maximum edge", () => {
  assert.deepEqual(getContainedImageSize(4032, 3024), { width: 1024, height: 768 });
});

test("does not enlarge images that already fit", () => {
  assert.deepEqual(getContainedImageSize(800, 1200, 1280), { width: 800, height: 1200 });
});

test("uses an explicit optimized WebP suffix", () => {
  assert.equal(getOptimizedPhotoName("ramen.jpeg"), "ramen.optimized.webp");
  assert.equal(
    getOptimizedStoragePath("user/restaurant/ramen.jpeg"),
    "user/restaurant/ramen.optimized.webp",
  );
  assert.equal(isOptimizedStoragePath("user/restaurant/ramen.optimized.webp"), true);
  assert.equal(isOptimizedStoragePath("user/restaurant/ramen.jpeg"), false);
});
