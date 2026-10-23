import test from "node:test";
import assert from "node:assert/strict";
import { createVisitPhotoUploads } from "./photo-upload.ts";

test("creates upload entries for multiple visit photos", () => {
  const files = [
    { name: "ramen 1.jpg" },
    { name: "餃子.JPG" },
  ];

  assert.deepEqual(
    createVisitPhotoUploads({
      files,
      userId: "user-1",
      restaurantId: "restaurant-1",
      visitId: "visit-1",
      caption: "夜の訪問",
      createId: (() => {
        const ids = ["id-1", "id-2"];
        return () => ids.shift() ?? "unexpected";
      })(),
    }),
    [
      {
        file: files[0],
        path: "user-1/restaurant-1/id-1-ramen-1.jpg",
        row: {
          user_id: "user-1",
          restaurant_id: "restaurant-1",
          visit_id: "visit-1",
          storage_path: "user-1/restaurant-1/id-1-ramen-1.jpg",
          caption: "夜の訪問",
          sort_order: 0,
        },
      },
      {
        file: files[1],
        path: "user-1/restaurant-1/id-2-餃子.JPG",
        row: {
          user_id: "user-1",
          restaurant_id: "restaurant-1",
          visit_id: "visit-1",
          storage_path: "user-1/restaurant-1/id-2-餃子.JPG",
          caption: "夜の訪問",
          sort_order: 1,
        },
      },
    ],
  );
});

test("stores null captions when visit photo caption is blank", () => {
  const [upload] = createVisitPhotoUploads({
    files: [{ name: "dish.png" }],
    userId: "user-1",
    restaurantId: "restaurant-1",
    visitId: "visit-1",
    caption: "   ",
    createId: () => "id-1",
  });

  assert.equal(upload.row.caption, null);
});

test("appends photo sort order after existing photos", () => {
  const uploads = createVisitPhotoUploads({
    files: [{ name: "third.jpg" }, { name: "fourth.jpg" }],
    userId: "user-1",
    restaurantId: "restaurant-1",
    visitId: null,
    caption: "",
    startSortOrder: 2,
    createId: () => "id",
  });

  assert.deepEqual(uploads.map((upload) => upload.row.sort_order), [2, 3]);
});
