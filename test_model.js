require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');

async function listModels() {
    try {
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        // Em vez de listModels que pode prender, vamos testar o modelo básico
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const result = await model.generateContent("Oi");
        console.log("Sucesso com gemini-1.5-flash!");
        console.log(result.response.text());
    } catch (error) {
        console.error("Erro no teste:");
        console.error(error);
    }
}

listModels();
