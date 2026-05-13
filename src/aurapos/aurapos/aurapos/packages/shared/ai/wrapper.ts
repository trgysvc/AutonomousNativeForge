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
  private readonly defaultOptions: Required<Omit<DeepSeekWrapperOptions, 'apiKey' | 'baseURL'>>;
  private readonly agent: import('node:http').Agent | import('node:https').Agent | undefined;

  constructor(options: DeepSeekWrapperOptions = {}) {
    this.apiKey = options.apiKey ?? process.env.DEEPSEEK_API_KEY ?? '';
    if (!this.apiKey) {
      throw new Error('DeepSeek API key is required. Provide it in options or set DEEPSEEK_API_KEY environment variable.');
    }

    this.baseURL = options.baseURL ?? 'https://api.deepseek.com';

    this.defaultOptions = {
      model: options.model ?? 'deepseek-chat',
      temperature: options.temperature ?? 0.7,
      maxTokens: options.maxTokens ?? 1000,
      topP: options.topP ?? 1.0,
      frequencyPenalty: options.frequencyPenalty ?? 0.0,
      presencePenalty: options.presencePenalty ?? 0.0,
    };

    const url = new URL(this.baseURL);
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      const agentOptions = {
        keepAlive: true,
        maxSockets: 10,
        freeSocketTimeout: 30000,
        timeout: 60000,
      };
      this.agent = url.protocol === 'https:'
        ? new (require('node:https')).Agent(agentOptions)
        : new (require('node:http')).Agent(agentOptions);
    }
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

    const fetchOptions: RequestInit = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(requestBody),
    };

    if