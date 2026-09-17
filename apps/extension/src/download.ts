/** MV3 service workers cannot rely on Blob object URLs. */
export const MAX_DOWNLOAD_BYTES = 1_200_000;

export function textDownloadUrl(text: string, extension = "txt"): string | null {
  const bytes = new TextEncoder().encode(text);
  if (bytes.length > MAX_DOWNLOAD_BYTES) return null;
  let binary = "";
  // Chunking avoids argument-size limits for larger captured source files.
  for (let start = 0; start < bytes.length; start += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000));
  }
  const mediaType = extension.toLowerCase() === "txt" ? "text/plain;charset=utf-8" : "application/octet-stream";
  return `data:${mediaType};base64,${btoa(binary)}`;
}
