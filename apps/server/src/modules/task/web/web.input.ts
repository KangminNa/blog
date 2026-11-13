import { BaseRequest } from '../../platform';

/** read_url: { "url": "https://…" } */
export class ReadUrlInput extends BaseRequest {
  static readonly URL_MAX = 2048;

  private constructor(readonly url: URL) {
    super();
  }

  static from(raw: unknown): ReadUrlInput {
    return BaseRequest.read(raw, (f) => {
      const text = f.text('url', ReadUrlInput.URL_MAX).trim();
      let url: URL | null = null;
      try {
        url = new URL(text);
      } catch {
        f.reject('url', 'http(s)://로 시작하는 주소여야 해요');
      }
      if (url && url.protocol !== 'http:' && url.protocol !== 'https:')
        f.reject('url', 'http · https 주소만 열 수 있어요');
      return new ReadUrlInput(url ?? new URL('http://invalid'));
    });
  }
}
