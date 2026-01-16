const OpenAI = require('openai');
const { SAMANTHA_SYSTEM_PROMPT } = require('./lib/samantha');
const { supabase } = require('./lib/db');

const DEEPSEEK_KEY = process.env.DEEPSEEK_API_KEY;

let openai = null;
if (DEEPSEEK_KEY) {
    openai = new OpenAI({
        apiKey: DEEPSEEK_KEY,
        baseURL: 'https://openrouter.ai/api/v1',
    });
}

module.exports = async (req, res) => {
    if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

    try {
        const sessionId = `session_${Date.now()}`;

        if (!openai) {
            throw new Error('DEEPSEEK_API_KEY não configurada no servidor.');
        }

        const completion = await openai.chat.completions.create({
            model: "deepseek/deepseek-r1:free",
            messages: [
                { role: "system", content: SAMANTHA_SYSTEM_PROMPT },
                { role: "user", content: "Inicie a conversa se apresentando brevemente e pergunte o nome da pessoa." }
            ]
        });

        const response = completion.choices[0].message.content;

        // Persistência no Supabase
        if (supabase) {
            await supabase.from('samantha_conversations').insert([
                { session_id: sessionId, role: 'user', content: 'Inicie a conversa se apresentando' },
                { session_id: sessionId, role: 'assistant', content: response }
            ]);
        }

        res.json({ response, sessionId, model: "deepseek" });
    } catch (error) {
        console.error('Error in /api/start:', error);

        res.status(500).json({
            error: 'Erro ao iniciar conversa (DeepSeek)',
            details: error.message,
            hint: "Verifique a DEEPSEEK_API_KEY nas Environment Variables da Vercel."
        });
    }
};
