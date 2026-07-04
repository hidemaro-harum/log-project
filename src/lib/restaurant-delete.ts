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

  if (storagePaths.length > 0) {
    const { error } = await client.storage.from("food-photos").remove(storagePaths);
    if (error) throw new Error(error.message ?? "写真の削除に失敗しました。");
  }

  const { error } = await client.from("restaurants").delete().eq("id", restaurant.id);
  if (error) throw new Error(error.message ?? "店舗の削除に失敗しました。");
}
