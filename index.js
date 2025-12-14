// api/index.js

export const config = {
  runtime: 'edge', // Используем Edge для скорости и длинных таймаутов
};

export default async function handler(req) {
  // 1. CORS заголовки (чтобы Janitor не ругался)
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': '*',
  };

  // Обработка preflight запроса
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    // 2. Получаем API ключ из заголовка Authorization
    const authHeader = req.headers.get('Authorization');
    const apiKey = authHeader ? authHeader.replace('Bearer ', '').trim() : null;

    if (!apiKey) {
      return new Response(JSON.stringify({ error: "No API Key provided" }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Если это просто проверка связи (GET)
    if (req.method === 'GET') {
      return new Response(JSON.stringify({
        object: "list",
        data: [{ id: "gemini-1.5-flash", object: "model" }, { id: "gemini-1.5-pro", object: "model" }]
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // 3. Разбираем запрос от Janitor
    const body = await req.json();
    const messages = body.messages || [];

    // --- ЛОГИКА АДАПТАЦИИ СООБЩЕНИЙ ---
    let contents = [];
    let systemInstruction = null;

    for (const msg of messages) {
      if (msg.role === 'system') {
        // Системный промпт
        systemInstruction = { parts: [{ text: msg.content }] };
      } else {
        const role = msg.role === 'assistant' ? 'model' : 'user';
        // Gemini ненавидит, когда сообщения с одной ролью идут подряд.
        // Если предыдущее сообщение от того же автора -> склеиваем их.
        if (contents.length > 0 && contents[contents.length - 1].role === role) {
          contents[contents.length - 1].parts[0].text += "\n\n" + msg.content;
        } else {
          contents.push({ role, parts: [{ text: msg.content }] });
        }
      }
    }

    // Gemini требует, чтобы диалог заканчивался на User. Если вдруг Model -> добавляем заглушку.
    if (contents.length > 0 && contents[contents.length - 1].role === 'model') {
      contents.push({ role: 'user', parts: [{ text: "(Continue generating)" }] });
    }

    // Выбор модели (по дефолту flash, если попросили pro - даем pro)
    let model = "gemini-1.5-flash";
    if (body.model && body.model.includes("pro")) model = "gemini-1.5-pro";

    const googleUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    // 4. Отправляем запрос в Google
    const googleRes = await fetch(googleUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents,
        system_instruction: systemInstruction,
        safetySettings: [
            { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
        ],
        generationConfig: {
          temperature: body.temperature || 1.0,
          maxOutputTokens: 8192
        }
      })
    });

    if (!googleRes.ok) {
      const errorText = await googleRes.text();
      return new Response(JSON.stringify({ error: `Google Error: ${errorText}` }), {
        status: googleRes.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const data = await googleRes.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";

    // 5. Отдаем ответ в формате OpenAI
    const responseBody = {
      id: "chatcmpl-" + Date.now(),
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: model,
      choices: [{
        index: 0,
        message: { role: "assistant", content: text },
        finish_reason: "stop"
      }]
    };

    return new Response(JSON.stringify(responseBody), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}
