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

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

module.exports = async (req, res) => {
    if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

    try {
        const { message, history, sessionId } = req.body;
        if (!message) return res.status(400).json({ error: 'Message required' });

        if (!openai) {
            throw new Error('DEEPSEEK_API_KEY não configurada no servidor.');
        }

        let response;
        const conversationHistory = (history || []).map(item => ({
            role: item.role === 'model' ? 'assistant' : 'user',
            content: item.parts[0].text
        }));

        const completion = await openai.chat.completions.create({
            model: "deepseek/deepseek-chat",
            messages: [
                { role: "system", content: SAMANTHA_SYSTEM_PROMPT },
                ...conversationHistory,
                { role: "user", content: message }
            ],
            max_tokens: 1500
        });

        response = completion.choices[0].message.content;

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

        res.json({ response, isRetrato, retratoData, sessionId, model: "deepseek" });

    } catch (error) {
        console.error('Error in /api/chat:', error);
        res.status(500).json({
            error: 'Erro no DeepSeek',
            details: error.message,
            hint: "Verifique a chave DEEPSEEK_API_KEY ou créditos no OpenRouter."
        });
    }
};
