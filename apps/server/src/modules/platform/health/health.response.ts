import { BaseResponse } from '../base/base-response';
import type { HealthView } from './health.query';

export class HealthResponse extends BaseResponse {
  private constructor(private readonly view: HealthView) {
    super();
  }

  static of(view: HealthView): HealthResponse {
    return new HealthResponse(view);
  }

  toJSON(): object {
    return {
      status: 'ok',
      extensions: Object.fromEntries(this.view.extensions),
      migrations: this.view.migrations,
      tables: Object.fromEntries(this.view.tablesBySchema),
    };
  }
}
