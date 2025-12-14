export const config = {
  runtime: 'edge',
};

export default async function handler(req) {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': '*',
  };

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    const apiKey = authHeader ? authHeader.replace('Bearer ', '').trim() : null;

    if (!apiKey) {
      return new Response(JSON.stringify({ error: "No OpenAI API Key provided" }), { 
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }

    // Если Janitor спрашивает список моделей
    if (req.method === 'GET') {
      return new Response(JSON.stringify({
        object: "list",
        data: [
            { id: "gpt-4o", object: "model" },
            { id: "gpt-4-turbo", object: "model" },
            { id: "gpt-3.5-turbo", object: "model" }
        ]
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const body = await req.json();

    // --- ВЫБОР МОДЕЛИ ---
    // Если в Janitor ты напишешь "gpt-5.2" или что угодно, оно уйдет в OpenAI.
    // Если поле пустое, по дефолту ставим gpt-4o.
    if (!body.model) {
        body.model = "gpt-4o";
    }

    // Отправляем запрос напрямую в OpenAI
    const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(body)
    });

    // Получаем ответ и отдаем Janitor как есть
    const data = await openaiRes.json();
    
    return new Response(JSON.stringify(data), { 
        status: openaiRes.status, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { 
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    });
  }
}
