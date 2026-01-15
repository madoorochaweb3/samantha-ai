require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const OpenAI = require('openai');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Configurações das APIs
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const DEEPSEEK_KEY = process.env.DEEPSEEK_API_KEY;

let openai = null;
if (DEEPSEEK_KEY && !DEEPSEEK_KEY.startsWith('sk-f27')) { // Se não for a chave que sabemos estar sem saldo
    openai = new OpenAI({
        apiKey: DEEPSEEK_KEY,
        baseURL: 'https://openrouter.ai/api/v1',
        defaultHeaders: {
            "HTTP-Referer": "http://localhost:3000",
            "X-Title": "Samantha AI"
        }
    });
}

// System prompt para a Samantha
const SAMANTHA_SYSTEM_PROMPT = `Você é a Samantha, uma IA empática e acolhedora da equipe da Madú Rocha, criadora do projeto "Horas Devolvidas".

## Sua Personalidade
- Você é calorosa, curiosa e genuinamente interessada no trabalho das pessoas
- Usa linguagem informal brasileira (você, teu, tu - mistura natural)
- Faz perguntas que mostram que está prestando atenção
- Nunca usa emojis em excesso
- É direta mas gentil

## Seu Objetivo
Você conduz uma entrevista para entender profundamente o trabalho da pessoa. Seu objetivo é:
1. Coletar: nome, email, profissão
2. Explorar: rotina de trabalho, tarefas repetitivas, onde demora mais, o que trava
3. Identificar: oportunidades de automação que podem devolver 3-4 horas por dia

## Fluxo da Conversa
Siga esta ordem (mas de forma natural, não robótica):

FASE 1 - APRESENTAÇÃO:
- Se apresente brevemente e pergunte o nome

FASE 2 - CONTEXTO (após receber nome):
- Explique que vai fazer algumas perguntas sobre o trabalho
- Diga que no final vai devolver um "retrato" do fluxo de trabalho
- Peça o email para a Madú poder entrar em contato depois

FASE 3 - PROFISSÃO (após email):
- Pergunte o que a pessoa faz profissionalmente

FASE 4 - EXPLORAÇÃO (após profissão):
- Pergunte como é um dia típico de trabalho
- O que faz quando começa o dia
- Quais tarefas são repetitivas
- O que demora mais tempo
- O que mais frustra ou trava
- Faça de 5 a 8 perguntas de exploração

FASE 5 - FECHAMENTO:
- Quando tiver informação suficiente (após ~8-10 trocas durante exploração), gere o RETRATO
- O retrato deve ser um JSON estruturado

## Formato do Retrato
Quando estiver pronta para encerrar, responda APENAS com um JSON neste formato (sem texto antes ou depois):
\`\`\`json
{
  "tipo": "retrato",
  "dados": {
    "nome": "Nome da pessoa",
    "email": "email@exemplo.com",
    "profissao": "O que ela faz",
    "resumo_trabalho": "Descrição do que ela faz baseado na conversa",
    "fluxo_diario": "Como funciona o dia a dia dela",
    "gargalos": ["Lista de pontos que travam ou demoram"],
    "tarefas_repetitivas": ["Lista de tarefas manuais e repetitivas"],
    "oportunidades": ["Oportunidades de automação identificadas"],
    "horas_potenciais": "Estimativa de horas que podem ser devolvidas por dia"
  }
}
\`\`\`

## Regras Importantes
- Nunca invente informação - use apenas o que a pessoa disse
- Se algo não foi mencionado, pergunte antes de incluir no retrato
- Mantenha respostas curtas (1-3 frases quando possível)
- Uma pergunta por vez
- Seja empática quando a pessoa expressar frustração
- Lembre-se do contexto da conversa toda`;

// Memory Store
const conversations = new Map();

// Helper para Delay (Backoff)
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Função Robusta Gemini com Retry
async function callGemini(chatSession, message, maxRetries = 5) {
    let retryCount = 0;
    while (retryCount <= maxRetries) {
        try {
            const result = await chatSession.sendMessage(message);
            return result.response.text();
        } catch (error) {
            const isRateLimit = error.message && (error.message.includes('429') || error.message.includes('Quota exceeded'));
            if (isRateLimit && retryCount < maxRetries) {
                retryCount++;
                const waitTime = Math.min(Math.pow(2, retryCount) * 5000 + Math.random() * 1000, 65000);
                console.log(`⚠️ Gemini 429. Tentativa ${retryCount}/${maxRetries} em ${Math.round(waitTime / 1000)}s...`);
                await delay(waitTime);
                continue;
            }
            throw error;
        }
    }
}

// Chat endpoint
app.post('/api/chat', async (req, res) => {
    try {
        const { sessionId, message, history } = req.body;
        if (!message) return res.status(400).json({ error: 'Message required' });

        let response;
        let usedModel = "gemini";

        // Tenta DeepSeek se a chave for válida, senão usa Gemini
        if (openai) {
            try {
                const conversationHistory = (history || conversations.get(sessionId) || []).map(item => ({
                    role: item.role === 'model' ? 'assistant' : 'user',
                    content: item.parts[0].text
                }));

                const completion = await openai.chat.completions.create({
                    model: "deepseek/deepseek-r1-0528:free",
                    messages: [
                        { role: "system", content: SAMANTHA_SYSTEM_PROMPT },
                        ...conversationHistory,
                        { role: "user", content: message }
                    ]
                });
                response = completion.choices[0].message.content;
                usedModel = "deepseek";
            } catch (e) {
                console.log("Falha no DeepSeek, tentando Gemini...", e.message);
                openai = null; // Desabilita para próximas tentativas se falhar
            }
        }

        if (!response) {
            const model = genAI.getGenerativeModel({
                model: 'gemini-2.0-flash',
                systemInstruction: SAMANTHA_SYSTEM_PROMPT
            });
            const chat = model.startChat({ history: history || conversations.get(sessionId) || [] });
            response = await callGemini(chat, message);
        }

        // Update history
        const currentHistory = history || conversations.get(sessionId) || [];
        currentHistory.push({ role: 'user', parts: [{ text: message }] });
        currentHistory.push({ role: 'model', parts: [{ text: response }] });
        conversations.set(sessionId, currentHistory);

        // Extract JSON
        let isRetrato = false;
        let retratoData = null;
        try {
            const jsonMatch = response.match(/```json\s*([\s\S]*?)\s*```/);
            if (jsonMatch) {
                retratoData = JSON.parse(jsonMatch[1]);
                if (retratoData.tipo === 'retrato') isRetrato = true;
            }
        } catch (e) { }

        res.json({ response, isRetrato, retratoData, sessionId, model: usedModel });

    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Erro no processamento', details: error.message });
    }
});

// Start chat endpoint
app.post('/api/start', async (req, res) => {
    try {
        const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        let response;
        let usedModel = "gemini";

        if (openai) {
            try {
                const completion = await openai.chat.completions.create({
                    model: "deepseek/deepseek-r1-0528:free",
                    messages: [
                        { role: "system", content: SAMANTHA_SYSTEM_PROMPT },
                        { role: "user", content: "Inicie a conversa se apresentando brevemente e pergunte o nome da pessoa." }
                    ]
                });
                response = completion.choices[0].message.content;
                usedModel = "deepseek";
            } catch (e) {
                console.log("Falha inicial no DeepSeek, tentando Gemini...", e.message);
                openai = null;
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

        conversations.set(sessionId, [
            { role: 'user', parts: [{ text: 'Inicie a conversa se apresentando' }] },
            { role: 'model', parts: [{ text: response }] }
        ]);

        res.json({ response, sessionId, model: usedModel });
    } catch (error) {
        console.error('Error starting:', error);
        res.status(500).json({ error: 'Falha ao iniciar chat', details: error.message });
    }
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'samantha-chat.html')));

app.listen(PORT, () => {
    console.log(`🌟 Samantha AI (Hybrid Edition) running at http://localhost:${PORT}`);
    console.log(`📋 Fallback: Gemini 2.0-flash | OpenRouter: ${openai ? 'Enabled' : 'Waiting for key'}`);
});
