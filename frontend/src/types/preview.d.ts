export {};

declare global {
  interface Window {
    /** Present only in the static preview build (see src/preview/setup.ts). */
    __SIYULAH_PREVIEW__?: {
      today: string;
      now: number;
      handle: (method: string, path: string, body: unknown) => Promise<unknown>;
    };
  }
}
