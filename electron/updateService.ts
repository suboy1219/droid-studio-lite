export const projectUrl = 'https://github.com/suboy1219/droid-studio-lite';
const latestReleaseApi = 'https://api.github.com/repos/suboy1219/droid-studio-lite/releases/latest';

export function parseVersion(value: string): number[] {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:\.(\d+))?(?:\+[\w.-]+)?$/i.exec(value.trim());
  if (!match) throw new Error('无法识别发布版本号。');
  const parts = match.slice(1, 5).map((part) => Number(part ?? 0));
  if (parts.some((part) => !Number.isSafeInteger(part))) throw new Error('无效的发布版本号。');
  return parts;
}

export async function checkForUpdates(
  currentVersion: string,
  fetcher: (url: string, init: RequestInit) => Promise<Response> = fetch
) {
  const current = parseVersion(currentVersion);
  const response = await fetcher(latestReleaseApi, {
    headers: {
      'User-Agent': `DroidStudioLite/${currentVersion}`,
      Accept: 'application/vnd.github+json'
    },
    signal: AbortSignal.timeout(10000)
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`GitHub HTTP ${response.status}`);
  const release = await response.json();
  if (!release || typeof release !== 'object') throw new Error('更新信息为空。');
  if (release.draft || release.prerelease) return null;
  if (typeof release.tag_name !== 'string') throw new Error('缺少发布版本号。');
  const tag = release.tag_name.trim();
  const latest = parseVersion(tag);
  let comparison = 0;
  for (let i = 0; i < current.length && comparison === 0; i++) comparison = latest[i] - current[i];
  return {
    currentVersion,
    tag,
    isUpdateAvailable: comparison > 0,
    releaseUrl: `${projectUrl}/releases/tag/${encodeURIComponent(tag)}`
  };
}
