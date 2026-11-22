import {
  BadGatewayException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { QuestionType } from '../exams/schemas/question.schema.js';
import type { PdfKind } from './dto/offline.dto.js';

export interface RenderQuestion {
  text: string;
  type: QuestionType;
  options: string[];
  points: number;
  /** Only sent for the answer key */
  correct?: number[];
}

export interface RenderPayload {
  kind: PdfKind;
  session: {
    id: string;
    name: string;
    examTitle: string;
    date: string | null;
    duration: number;
    passingScore: number;
  };
  variants: { letter: string; questions: RenderQuestion[] }[];
}

/** Talks to the exam-omr Python service, which renders printable PDFs (and later reads scans). */
@Injectable()
export class OmrClient {
  private readonly url: string;
  private readonly key?: string;

  constructor(config: ConfigService) {
    this.url = config.get<string>('OMR_URL', 'http://127.0.0.1:5100');
    this.key = config.get<string>('OMR_API_KEY');
  }

  async renderPdf(payload: RenderPayload): Promise<Buffer> {
    let res: Response;
    try {
      res = await fetch(`${this.url}/render`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.key && { 'X-OMR-Key': this.key }),
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(60_000),
      });
    } catch {
      throw new ServiceUnavailableException(
        'The PDF service (exam-omr) is not running',
      );
    }
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 300);
      throw new BadGatewayException(`PDF service error: ${detail}`);
    }
    return Buffer.from(await res.arrayBuffer());
  }
}
