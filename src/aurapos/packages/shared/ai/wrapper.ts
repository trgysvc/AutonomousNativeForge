import { Agent as HttpAgent } from 'node:http';
import { Agent as HttpsAgent } from 'node:https';

interface DeepSeekWrapperOptions {
  apiKey?: string;
  baseURL?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
}

interface ChatCompletionRequest {
  model: string;
  messages: { role: 'user' | 'assistant' | 'system'; content: string }[];
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  stream?: boolean;
}

interface ChatCompletionResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: {
    index: number;
    message: {
      role: 'assistant';
      content: string;
    };
    finish_reason: string;
  }[];
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export class DeepSeekWrapper {
  private readonly baseURL: string;
  private readonly apiKey: string;
  private readonly httpAgent: HttpAgent;
  private readonly httpsAgent: HttpsAgent;
  private readonly defaultOptions: Required<Omit<DeepSeekWrapperOptions, 'apiKey' | 'baseURL'>>;

  constructor(options: DeepSeekWrapperOptions = {}) {
    this.apiKey = options.apiKey ?? process.env.DEEPSEEK_API_KEY ?? '';
    if (!this.apiKey) {
      throw new Error('DeepSeek API key is required. Provide it in options or set DEEPSEEK_API_KEY environment variable.');
    }

    this.baseURL = options.baseURL ?? 'https://api.deepseek.com';
    this.httpAgent = new HttpAgent({ keepAlive: true });
    this.httpsAgent = new HttpsAgent({ keepAlive: true });

    this.defaultOptions = {
      model: options.model ?? 'deepseek-chat',
      temperature: options.temperature ?? 0.7,
      maxTokens: options.maxTokens ?? 1000,
      topP: options.topP ?? 1.0,
      frequencyPenalty: options.frequencyPenalty ?? 0.0,
      presencePenalty: options.presencePenalty ?? 0.0,
    };
  }

  async generate(prompt: string, options: Partial<DeepSeekWrapperOptions> = {}): Promise<string> {
    const mergedOptions = { ...this.defaultOptions, ...options };
    const url = `${this.baseURL}/v1/chat/completions`;

    const requestBody: ChatCompletionRequest = {
      model: mergedOptions.model,
      messages: [{ role: 'user', content: prompt }],
      temperature: mergedOptions.temperature,
      max_tokens: mergedOptions.maxTokens,
      top_p: mergedOptions.topP,
      frequency_penalty: mergedOptions.frequencyPenalty,
      presence_penalty: mergedOptions.presencePenalty,
      stream: false,
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(requestBody),
      agent: this.getAgent(url),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`DeepSeek API error: ${response.status} - ${errorText}`);
    }

    const data: ChatCompletionResponse = await response.json();
    return data.choices[0]?.message.content ?? '';
  }

  private getAgent(url: string): HttpAgent | HttpsAgent {
    return url.startsWith('https://') ? this.httpsAgent : this.httpAgent;
  }
}