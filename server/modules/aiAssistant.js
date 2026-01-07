import OpenAI from 'openai';
import { config } from '../config.js';

const openai = new OpenAI();

/**
 * Query AI assistant with text
 */
export async function queryAI(text) {
  const response = await openai.chat.completions.create({
    model: config.aiModel,
    messages: [
      {
        role: 'system',
        content: config.aiSystemPrompt
      },
      {
        role: 'user',
        content: text
      }
    ],
    max_tokens: config.aiMaxTokens
  });

  return response.choices[0].message.content;
}
