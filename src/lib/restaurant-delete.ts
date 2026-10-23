import type { Restaurant } from "@/types/database";

type SupabaseLikeError = { message?: string };

type DeleteClient = {
  storage: {
    from(bucket: string): {
      remove(paths: string[]): PromiseLike<{ error: SupabaseLikeError | null }>;
    };
  };
  from(table: string): {
    delete(): {
      eq(column: string, value: string): PromiseLike<{ error: SupabaseLikeError | null }>;
    };
  };
};

export async function deleteRestaurantWithAssets(client: DeleteClient, restaurant: Restaurant) {
  const storagePaths = [...new Set((restaurant.photos ?? []).map((photo) => photo.storage_path).filter(Boolean))];

  // A failed or lost DB response must never remove files still referenced by a
  // restaurant. A retry may safely confirm a zero-row delete before cleanup.
  const { error } = await client.from("restaurants").delete().eq("id", restaurant.id);
  if (error) throw new Error(error.message ?? "店舗の削除に失敗しました。");

  if (storagePaths.length > 0) {
    try {
      const { error: storageError } = await client.storage.from("food-photos").remove(storagePaths);
      if (storageError) throw storageError;
    } catch {
      throw new Error("店舗は削除しましたが、写真ファイルの削除を確認できませんでした。もう一度削除を実行してください。");
    }
  }
}
