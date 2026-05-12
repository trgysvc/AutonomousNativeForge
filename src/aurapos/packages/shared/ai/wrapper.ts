export interface DeepSeekConfig {
    apiKey: string;
    baseURL?: string;
}

export class DeepSeekWrapper {
    private apiKey: string;
    private baseURL: string;

    constructor(config: Partial<DeepSeekConfig> = {}) {
        this.apiKey = config.apiKey ?? process.env.DEEPSEEK_API_KEY;
        if (!this.apiKey) {
            throw new Error('DeepSeek API key is required. Provide it in config or set DEEPSEEK_API_KEY environment variable.');
        }
        this.baseURL = config.baseURL ?? process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com/v1';
    }

    async chatCompletion(
        messages: Array<{ role: string; content: string }>,
        options: {
            model?: string;
            temperature?: number;
            maxTokens?: number;
            [key: string]: any;
        } = {}
    ) {
        const {
            model = 'deepseek-chat',
            temperature,
            maxTokens,
            ...rest
        } = options;

        const body: any = {
            model,
            messages,
            ...(temperature !== undefined && { temperature }),
            ...(maxTokens !== undefined && { max_tokens: maxTokens }),
            ...rest
        };

        const url = `${this.baseURL}/chat/completions`;

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.apiKey}`
            },
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`DeepSeek API request failed with status ${response.status}: ${errorText}`);
        }

        return response.json();
    }
}