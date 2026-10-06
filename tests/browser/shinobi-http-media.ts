export const createShinobiHTTPMediaURL = (responses: number[]): string =>
  `/shinobi-test-media?${new URLSearchParams({
    token: crypto.randomUUID(),
    responses: responses.join(','),
  })}`;

export const releaseShinobiHTTPMedia = async (url: string): Promise<void> => {
  const token = new URL(url, window.location.href).searchParams.get('token');
  const response = await fetch(
    `/shinobi-test-media-count?${new URLSearchParams({ token: token ?? '' })}`,
    { method: 'POST' },
  );
  if (!response.ok) {
    throw new Error('Synthetic HTTP recovery could not be enabled');
  }
};

export const getShinobiHTTPMediaRequestCount = async (url: string): Promise<number> => {
  const token = new URL(url, window.location.href).searchParams.get('token');
  const response = await fetch(
    `/shinobi-test-media-count?${new URLSearchParams({ token: token ?? '' })}`,
    { cache: 'no-store' },
  );
  const value: unknown = await response.json();
  if (
    !response.ok ||
    typeof value !== 'object' ||
    value === null ||
    !('count' in value) ||
    typeof value.count !== 'number' ||
    !Number.isSafeInteger(value.count)
  ) {
    throw new Error('Synthetic HTTP request counter unavailable');
  }
  return value.count;
};
