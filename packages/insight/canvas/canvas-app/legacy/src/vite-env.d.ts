/// <reference types="vite/client" />
/// <reference types="vite-plugin-svgr/client" />

import type { AppVersionInfo } from './version/schema';

declare global {
  const __APP_ENV__: string | undefined;
  const __APP_VERSION__: AppVersionInfo;
}

declare module 'esdk-obs-browserjs' {
  class ObsClient {
    constructor(config: { access_key_id: string; secret_access_key: string; security_token: string; server: string });
    uploadFile(params: any, callback: any): void;
    getObject(
      params: { Bucket: string; Key: string; SaveByType?: string },
      callback: (
        err?: Error,
        success: (result: {
          CommonMsg: {
            Status: number;
            InterfaceResult: boolean;
          };
          InterfaceResult: {
            Content: {
              SignedUrl: string;
            };
          };
        }) => void
      ) => void
    ): void;
  }
  export default ObsClient;
}

export {};
