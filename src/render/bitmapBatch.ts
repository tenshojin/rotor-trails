// A failed parallel image request must still close images that finish after it.
// The caller owns successful batches and closes them after copying their pixels.
export async function loadBitmapBatch(paths: readonly string[]): Promise<ImageBitmap[]> {
  const results = await Promise.allSettled(
    paths.map(async (path) => {
      const response = await fetch(new URL(path, document.baseURI).href);
      if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
      return createImageBitmap(await response.blob(), {
        premultiplyAlpha: 'none',
        colorSpaceConversion: 'none',
        imageOrientation: 'none',
      });
    }),
  );
  const failure = results.find((result) => result.status === 'rejected');
  if (failure) {
    for (const result of results) if (result.status === 'fulfilled') result.value.close();
    throw failure.reason;
  }
  return results.map((result) => (result as PromiseFulfilledResult<ImageBitmap>).value);
}
