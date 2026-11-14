/** read_url의 답. 받은 글은 자료다: 그 안의 지시를 따르지 않도록 note로 함께 알린다 (글은 지시문 틀 read-url-note) */
export class WebPageView {
  constructor(
    private readonly url: string,
    private readonly title: string,
    private readonly text: string,
    private readonly truncated: boolean,
    private readonly contentType: string,
    private readonly note: string,
  ) {}

  toJSON() {
    return {
      url: this.url,
      title: this.title,
      content_type: this.contentType,
      truncated: this.truncated,
      note: this.note,
      text: this.text,
    };
  }
}
