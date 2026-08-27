import { ConfigService } from '@nestjs/config';
import { OpenAiProvider } from './openai.provider';

const mockCreate = jest.fn();

jest.mock('openai', () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      chat: { completions: { create: mockCreate } },
    })),
  };
});

describe('OpenAiProvider construction with a real (unmocked) apiKey', () => {
  it('does not throw when constructed with an empty apiKey', () => {
    // Regression test for a real startup bug: the real `openai` SDK client
    // throws synchronously in its constructor when apiKey is empty/missing.
    // Since OpenAiProvider is a normal (non-lazy) NestJS provider, that
    // exception used to propagate up through module instantiation and
    // crash the entire app at boot — not just fail a scoring call — any
    // time OPENAI_API_KEY isn't configured. This must never happen: a
    // missing/misconfigured AI credential should only break AI-dependent
    // calls at call-time (returning null, per the AiProvider contract),
    // the same "never block on AI" philosophy applied to startup itself.
    jest.unmock('openai');
    jest.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { OpenAiProvider: RealOpenAiProvider } = require('./openai.provider');
    const emptyKeyConfig = {
      get: jest.fn((key: string) => {
        if (key === 'openai.apiKey') return '';
        if (key === 'openai.model') return 'gpt-4o-mini';
        return undefined;
      }),
    } as unknown as ConfigService;

    expect(() => new RealOpenAiProvider(emptyKeyConfig)).not.toThrow();
  });
});

describe('OpenAiProvider', () => {
  let provider: OpenAiProvider;
  let config: ConfigService;

  beforeEach(() => {
    mockCreate.mockReset();
    config = {
      get: jest.fn((key: string) => {
        if (key === 'openai.apiKey') return 'test-key';
        if (key === 'openai.model') return 'gpt-4o-mini';
        return undefined;
      }),
    } as unknown as ConfigService;
    provider = new OpenAiProvider(config);
  });

  describe('guessOnvifSupport', () => {
    it('returns the parsed onvif guess on a successful call', async () => {
      mockCreate.mockResolvedValue({
        choices: [
          {
            message: {
              content: JSON.stringify({ onvif_supported: 'yes', reasoning: 'Known ONVIF-compliant line' }),
            },
          },
        ],
      });

      const result = await provider.guessOnvifSupport('Hikvision', 'DS-2CD2143G2-I');

      expect(result).toEqual({ onvifSupported: 'yes', reasoning: 'Known ONVIF-compliant line' });
      expect(mockCreate).toHaveBeenCalledTimes(1);
    });

    it('returns null when the API call rejects on both the initial attempt and the retry', async () => {
      mockCreate.mockRejectedValue(new Error('timeout'));

      const result = await provider.guessOnvifSupport('Unknown', 'X1');

      expect(result).toBeNull();
      expect(mockCreate).toHaveBeenCalledTimes(2); // initial + 1 retry
    });

    it('returns null when the response content is not valid JSON', async () => {
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: 'not json' } }],
      });

      const result = await provider.guessOnvifSupport('Brand', 'Model');

      expect(result).toBeNull();
    });
  });

  describe('identifyFromPhoto', () => {
    it('returns the parsed brand/model on a successful call', async () => {
      mockCreate.mockResolvedValue({
        choices: [
          {
            message: { content: JSON.stringify({ brand: 'Hikvision', model: 'DS-2CD2143G2-I' }) },
          },
        ],
      });

      const result = await provider.identifyFromPhoto('https://res.cloudinary.com/demo/photo.jpg');

      expect(result).toEqual({ brand: 'Hikvision', model: 'DS-2CD2143G2-I' });
    });

    it('returns null when the API call fails', async () => {
      mockCreate.mockRejectedValue(new Error('network error'));

      const result = await provider.identifyFromPhoto('https://res.cloudinary.com/demo/photo.jpg');

      expect(result).toBeNull();
    });
  });
});
