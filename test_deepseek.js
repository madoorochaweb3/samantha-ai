require('dotenv').config();
const OpenAI = require('openai');

const DEEPSEEK_KEY = process.env.DEEPSEEK_API_KEY;

async function testDeepSeek() {
    try {
        const openai = new OpenAI({
            apiKey: DEEPSEEK_KEY,
            baseURL: 'https://openrouter.ai/api/v1',
        });

        const completion = await openai.chat.completions.create({
            model: "deepseek/deepseek-r1-0528:free",
            messages: [
                { role: "user", content: "Oi" }
            ],
        });
        console.log("Sucesso com DeepSeek!");
        console.log(completion.choices[0].message.content);
    } catch (error) {
        console.error("Erro no teste DeepSeek:");
        console.error(error);
    }
}

testDeepSeek();
