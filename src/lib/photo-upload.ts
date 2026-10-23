export type PhotoUploadFile = {
  name: string;
};

export type VisitPhotoUploadInput<TFile extends PhotoUploadFile> = {
  files: TFile[];
  userId: string;
  restaurantId: string;
  visitId: string | null;
  caption: string;
  startSortOrder?: number;
  createId: () => string;
};

export type VisitPhotoUpload<TFile extends PhotoUploadFile> = {
  file: TFile;
  path: string;
  row: {
    user_id: string;
    restaurant_id: string;
    visit_id: string | null;
    storage_path: string;
    caption: string | null;
    sort_order: number;
  };
};

export function createVisitPhotoUploads<TFile extends PhotoUploadFile>({
  files,
  userId,
  restaurantId,
  visitId,
  caption,
  startSortOrder = 0,
  createId,
}: VisitPhotoUploadInput<TFile>): VisitPhotoUpload<TFile>[] {
  const trimmedCaption = caption.trim();

  return files.map((file, index) => {
    const path = `${userId}/${restaurantId}/${createId()}-${sanitizeStorageFileName(file.name)}`;

    return {
      file,
      path,
      row: {
        user_id: userId,
        restaurant_id: restaurantId,
        visit_id: visitId,
        storage_path: path,
        caption: trimmedCaption || null,
        sort_order: startSortOrder + index,
      },
    };
  });
}

export function sanitizeStorageFileName(fileName: string) {
  return fileName.normalize("NFKC").replace(/[^\p{L}\p{N}._-]+/gu, "-");
}
