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
        const { message, history, sessionId } = req.body;
        if (!message) return res.status(400).json({ error: 'Message required' });

        let response;
        let usedModel = "gemini";

        // DeepSeek via OpenRouter (Prioridade)
        if (openai) {
            try {
                const conversationHistory = (history || []).map(item => ({
                    role: item.role === 'model' ? 'assistant' : 'user',
                    content: item.parts[0].text
                }));

                const completion = await openai.chat.completions.create({
                    model: "deepseek/deepseek-r1-0528:free",
                    messages: [
                        { role: "system", content: SAMANTHA_SYSTEM_PROMPT },
                        ...conversationHistory,
                        { role: "user", content: message }
                    ],
                    max_tokens: 1500
                });
                response = completion.choices[0].message.content;
                usedModel = "deepseek";
            } catch (e) {
                console.log("DeepSeek failed, falling back to Gemini.");
                openai = null;
            }
        }

        // Gemini Fallback
        if (!response) {
            const model = genAI.getGenerativeModel({
                model: 'gemini-2.0-flash',
                systemInstruction: SAMANTHA_SYSTEM_PROMPT
            });
            const chat = model.startChat({ history: history || [] });
            response = await callGemini(chat, message);
        }

        // Extract JSON for the Retrato
        let isRetrato = false;
        let retratoData = null;
        try {
            const jsonMatch = response.match(/```json\s*([\s\S]*?)\s*```/);
            if (jsonMatch) {
                retratoData = JSON.parse(jsonMatch[1]);
                if (retratoData.tipo === 'retrato') isRetrato = true;
            }
        } catch (e) { }

        // Persistência no Supabase
        if (supabase) {
            try {
                // Salvar mensagens
                await supabase.from('samantha_conversations').insert([
                    { session_id: sessionId, role: 'user', content: message },
                    { session_id: sessionId, role: 'assistant', content: response }
                ]);

                // Se for um retrato, salvar como lead
                if (isRetrato && retratoData) {
                    const { nome, email, profissao } = retratoData.dados;
                    await supabase.from('samantha_leads').insert([
                        {
                            nome,
                            email,
                            profissao,
                            retrato_json: retratoData
                        }
                    ]);
                }
            } catch (supaError) {
                console.error('Supabase Error:', supaError);
            }
        }

        res.json({ response, isRetrato, retratoData, sessionId, model: usedModel });

    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Erro no processamento', details: error.message });
    }
};
