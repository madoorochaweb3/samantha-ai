const { GoogleGenerativeAI } = require('@google/generative-ai');
const OpenAI = require('openai');
const { SAMANTHA_SYSTEM_PROMPT } = require('./lib/samantha');
const { supabase } = require('./lib/db');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const DEEPSEEK_KEY = process.env.DEEPSEEK_API_KEY;

let openai = null;
if (DEEPSEEK_KEY && !DEEPSEEK_KEY.startsWith('sk-f27')) {
    openai = new OpenAI({
        apiKey: DEEPSEEK_KEY,
        baseURL: 'https://openrouter.ai/api/v1',
    });
}

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function callGemini(chatSession, message, maxRetries = 3) {
    let retryCount = 0;
    while (retryCount <= maxRetries) {
        try {
            const result = await chatSession.sendMessage(message);
            return result.response.text();
        } catch (error) {
            const isRateLimit = error.message && (error.message.includes('429') || error.message.includes('Quota exceeded'));
            if (isRateLimit && retryCount < maxRetries) {
                retryCount++;
                await delay(2000 * retryCount);
                continue;
            }
            throw error;
        }
    }
}

module.exports = async (req, res) => {
    if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

    try {
        const sessionId = `session_${Date.now()}`;
        let response;
        let usedModel = "gemini";

        if (openai) {
            try {
                const completion = await openai.chat.completions.create({
                    model: "deepseek/deepseek-chat",
                    messages: [
                        { role: "system", content: SAMANTHA_SYSTEM_PROMPT },
                        { role: "user", content: "Inicie a conversa se apresentando brevemente e pergunte o nome da pessoa." }
                    ]
                });
                response = completion.choices[0].message.content;
                usedModel = "deepseek";
            } catch (e) {
                console.log("DeepSeek failed, using Gemini.");
            }
        }

        if (!response) {
            const model = genAI.getGenerativeModel({
                model: 'gemini-2.0-flash',
                systemInstruction: SAMANTHA_SYSTEM_PROMPT
            });
            const chat = model.startChat({});
            response = await callGemini(chat, 'Inicie a conversa se apresentando brevemente e pergunte o nome da pessoa.');
        }

        // Persistência no Supabase
        if (supabase) {
            await supabase.from('samantha_conversations').insert([
                { session_id: sessionId, role: 'user', content: 'Inicie a conversa se apresentando' },
                { session_id: sessionId, role: 'assistant', content: response }
            ]);
        }

        res.json({ response, sessionId, model: usedModel });
    } catch (error) {
        console.error('Error in /api/start:', error);

        // Verifica se é erro de API Key
        let errorMessage = error.message;
        if (!process.env.GEMINI_API_KEY && !process.env.DEEPSEEK_API_KEY) {
            errorMessage = "API Keys não configuradas na Vercel (GEMINI_API_KEY ou DEEPSEEK_API_KEY)";
        }

        res.status(500).json({
            error: 'Erro ao iniciar conversa',
            details: errorMessage,
            hint: "Verifique as 'Environment Variables' no painel da Vercel."
        });
    }
};
