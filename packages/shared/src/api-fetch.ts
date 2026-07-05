/** P7 mobile 14차 — web/mobile 공통 authenticated fetch */

export type ApiFetchHeaders = Record<string, string>;

export type HeaderBuilder<TSettings> = (
  settings: TSettings,
  init?: RequestInit,
) => ApiFetchHeaders;

export type SettingsRefresher<TSettings> = (
  settings: TSettings,
) => Promise<TSettings | null>;

export interface ApiFetchConfig<TSettings> {
  buildHeaders: HeaderBuilder<TSettings>;
  shouldRetryAuth?: (
    url: string,
    res: Response,
    settings: TSettings,
  ) => boolean;
  refreshSettings?: SettingsRefresher<TSettings>;
  onSettingsRefreshed?: (settings: TSettings) => void;
}

export function createApiFetch<TSettings>(
  config: ApiFetchConfig<TSettings>,
): (
  settings: TSettings,
  url: string,
  init?: RequestInit,
) => Promise<Response> {
  return async (settings, url, init) => {
    const attempt = (s: TSettings) =>
      fetch(url, {
        ...init,
        headers: config.buildHeaders(s, init),
      });

    let res = await attempt(settings);
    if (
      config.shouldRetryAuth?.(url, res, settings) &&
      config.refreshSettings
    ) {
      try {
        const next = await config.refreshSettings(settings);
        if (next) {
          config.onSettingsRefreshed?.(next);
          res = await attempt(next);
        }
      } catch {
        // keep original response
      }
    }
    return res;
  };
}
