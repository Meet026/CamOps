import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { AiProvider, OnvifGuessResult, PhotoIdentifyResult } from './ai-provider.interface';

const REQUEST_TIMEOUT_MS = 8000;
const RETRY_DELAY_MS = 500;

@Injectable()
export class OpenAiProvider implements AiProvider {
  private readonly logger = new Logger(OpenAiProvider.name);
  private readonly model: string;
  // Lazily constructed on first real call — never in the constructor. The
  // real OpenAI SDK throws synchronously if apiKey is empty/missing, and
  // this is a normal (eagerly-instantiated) NestJS provider, so throwing
  // here would crash the entire app at boot any time OPENAI_API_KEY isn't
  // configured — not just fail a scoring call. That violates the same
  // "AI failure must never block anything else" principle this class
  // already applies to individual calls (see callWithRetry), now extended
  // to construction itself.
  private client: OpenAI | null = null;

  constructor(private readonly config: ConfigService) {
    this.model = this.config.get<string>('openai.model') ?? 'gpt-4o-mini';
  }

  private getClient(): OpenAI | null {
    if (this.client) return this.client;
    try {
      this.client = new OpenAI({
        apiKey: this.config.get<string>('openai.apiKey'),
        timeout: REQUEST_TIMEOUT_MS,
      });
      return this.client;
    } catch (error) {
      this.logger.warn(
        `Failed to construct OpenAI client (likely missing OPENAI_API_KEY): ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  async guessOnvifSupport(brand: string, model: string): Promise<OnvifGuessResult | null> {
    const prompt = `Does the camera model '${brand} ${model}' support ONVIF? Respond only as JSON: { "onvif_supported": "yes"|"no"|"unsure", "reasoning": string }`;

    const raw = await this.callWithRetry(prompt);
    if (raw === null) return null;

    try {
      const parsed = JSON.parse(raw) as { onvif_supported: 'yes' | 'no' | 'unsure'; reasoning: string };
      return { onvifSupported: parsed.onvif_supported, reasoning: parsed.reasoning };
    } catch {
      this.logger.error(`guessOnvifSupport: response was not valid JSON: ${raw}`);
      return null;
    }
  }

  async identifyFromPhoto(photoUrl: string): Promise<PhotoIdentifyResult | null> {
    const raw = await this.callWithRetry(
      'Identify the camera brand and model number visible in this photo. Respond only as JSON: { "brand": string|null, "model": string|null }',
      photoUrl,
    );
    if (raw === null) return null;

    try {
      const parsed = JSON.parse(raw) as { brand: string | null; model: string | null };
      return { brand: parsed.brand, model: parsed.model };
    } catch {
      this.logger.error(`identifyFromPhoto: response was not valid JSON: ${raw}`);
      return null;
    }
  }

  // Shared call helper: one retry with a fixed short backoff, then null.
  // A single retry (not the SDK's own retry option) keeps the total worst-
  // case latency close to 2x the timeout, not unboundedly larger.
  private async callWithRetry(prompt: string, imageUrl?: string): Promise<string | null> {
    const client = this.getClient();
    if (!client) return null;

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const content = imageUrl
          ? [
              { type: 'text' as const, text: prompt },
              { type: 'image_url' as const, image_url: { url: imageUrl } },
            ]
          : prompt;

        const response = await client.chat.completions.create({
          model: this.model,
          response_format: { type: 'json_object' },
          messages: [{ role: 'user', content }],
        });

        const text = response.choices[0]?.message?.content;
        if (!text) return null;
        return text;
      } catch (error) {
        this.logger.warn(
          `AI provider call failed (attempt ${attempt + 1}/2): ${error instanceof Error ? error.message : String(error)}`,
        );
        if (attempt === 0) {
          await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
        }
      }
    }
    return null;
  }
}
