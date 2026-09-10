import type { CatalogueImage, ImageRights, Provenance } from "./models";
export interface CatalogueAssetStore {
  store(
    bytes: Uint8Array,
    metadata: Omit<CatalogueImage, "id" | "url">,
  ): Promise<CatalogueImage>;
  remove(id: string): Promise<void>;
}
export function validateImageMetadata(input: {
  mime: string;
  size: number;
  width: number;
  height: number;
  rights: ImageRights;
}) {
  if (!["image/png", "image/jpeg", "image/webp"].includes(input.mime))
    throw new Error("Only raster PNG, JPEG and WebP uploads are supported.");
  if (
    !Number.isInteger(input.size) ||
    input.size <= 0 ||
    input.size > 1_000_000
  )
    throw new Error("Image size must be between 1 byte and 1 MB.");
  if (
    !Number.isInteger(input.width) ||
    !Number.isInteger(input.height) ||
    input.width < 1 ||
    input.height < 1 ||
    input.width > 8192 ||
    input.height > 8192 ||
    input.width * input.height > 32_000_000
  )
    throw new Error("Image dimensions exceed the supported limits.");
}
/** Company uploads use local browser data URLs temporarily; licensed reference assets use CatalogueAssetStore. */
export async function readCompanyImage(file: File): Promise<{
  url: string;
  mime: string;
  size: number;
  width: number;
  height: number;
  rights: ImageRights;
}> {
  if (
    file.size > 1_000_000 ||
    !["image/png", "image/jpeg", "image/webp"].includes(file.type)
  )
    throw new Error("Choose a PNG, JPEG or WebP image smaller than 1 MB.");
  const url = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Image could not be read."));
    reader.readAsDataURL(file);
  });
  const size = await new Promise<{ width: number; height: number }>(
    (resolve, reject) => {
      const img = new Image();
      img.onload = () =>
        resolve({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () =>
        reject(new Error("The selected file is not a decodable image."));
      img.src = url;
    },
  );
  const result = {
    url,
    mime: file.type,
    size: file.size,
    ...size,
    rights: "COMPANY_OWNED" as const,
  };
  validateImageMetadata(result);
  return result;
}
export type AssetProvenance = Provenance;
