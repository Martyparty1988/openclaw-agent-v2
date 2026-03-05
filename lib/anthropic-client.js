class AnthropicClient {
  constructor() {
    this.apiKey = process.env.ANTHROPIC_API_KEY || '';
  }

  async createMessage(payload) {
    if (!this.apiKey) {
      return { content: [{ type: 'text', text: this.buildOfflineReply(payload) }], stop_reason: 'end_turn' };
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Anthropic API error: ${response.status} ${text.slice(0, 300)}`);
    }

    return response.json();
  }

  buildOfflineReply(payload) {
    const prompt = payload.messages?.[payload.messages.length - 1]?.content;
    if (typeof prompt === 'string' && prompt.toLowerCase().includes('execution plan')) {
      return JSON.stringify({
        goal: prompt.replace('Create an execution plan for:', '').trim(),
        agent: 'general',
        steps: [{ id: 1, action: 'Analyze task', details: 'Understand scope and desired output', tool: 'none' }],
      });
    }
    return 'Offline mode: ANTHROPIC_API_KEY is not set. I can run local QA, task management, and web controls.';
  }
}

module.exports = AnthropicClient;
