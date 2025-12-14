
export const config = {
  runtime: 'edge',
};

export default async function handler(req) {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
  };

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    const apiKey = authHeader ? authHeader.replace('Bearer ', '').trim() : null;

    if (!apiKey) {
      return new Response(JSON.stringify({ error: "No API Key" }), { 
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }

    if (req.method === 'GET') {
      return new Response(JSON.stringify({
        object: "list",
        data: [
            { id: "gemini-1.5-flash-latest", object: "model" }, 
            { id: "gemini-1.5-pro-latest", object: "model" }
        ]
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const body = await req.json();
    const messages = body.messages || [];

    let contents = [];
    let systemInstruction = null;

    for (const msg of messages) {
      if (msg.role === 'system') {
        systemInstruction = { parts: [{ text: msg.content }] };
      } else {
        const role = msg.role === 'assistant' ? 'model' : 'user';
        if (contents.length > 0 && contents[contents.length - 1].role === role) {
          contents[contents.length - 1].parts[0].text += "\n\n" + msg.content;
        } else {
          contents.push({ role, parts: [{ text: msg.content }] });
        }
      }
    }

    if (contents.length > 0 && contents[contents.length - 1].role === 'model') {
      contents.push({ role: 'user', parts: [{ text: "(Continue)" }] });
    }

    // --- ИСПРАВЛЕНИЕ: Используем точные названия версий ---
    // По умолчанию используем Flash Latest (самая стабильная версия)
    let targetModel = "gemini-1.5-flash-latest";
    
    // Если пользователь или Janitor просит "pro", переключаем на Pro Latest
    if (body.model && body.model.toLowerCase().includes("pro")) {
        targetModel = "gemini-1.5-flash-latest";
    }

    const googleUrl = `https://generativelanguage.googleapis.com/v1beta/models/${targetModel}:generateContent?key=${apiKey}`;

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

    return new Response(JSON.stringify({
      id: "chatcmpl-" + Date.now(),
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: targetModel,
      choices: [{
        index: 0,
        message: { role: "assistant", content: text },
        finish_reason: "stop"
      }]
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { 
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    });
  }
}

