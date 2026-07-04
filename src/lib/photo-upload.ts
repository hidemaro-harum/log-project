export type PhotoUploadFile = {
  name: string;
};

export type VisitPhotoUploadInput<TFile extends PhotoUploadFile> = {
  files: TFile[];
  userId: string;
  restaurantId: string;
  visitId: string;
  caption: string;
  createId: () => string;
};

export type VisitPhotoUpload<TFile extends PhotoUploadFile> = {
  file: TFile;
  path: string;
  row: {
    user_id: string;
    restaurant_id: string;
    visit_id: string;
    storage_path: string;
    caption: string | null;
  };
};

export function createVisitPhotoUploads<TFile extends PhotoUploadFile>({
  files,
  userId,
  restaurantId,
  visitId,
  caption,
  createId,
}: VisitPhotoUploadInput<TFile>): VisitPhotoUpload<TFile>[] {
  const trimmedCaption = caption.trim();

  return files.map((file) => {
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
      },
    };
  });
}

export function sanitizeStorageFileName(fileName: string) {
  return fileName.normalize("NFKC").replace(/[^\p{L}\p{N}._-]+/gu, "-");
}
