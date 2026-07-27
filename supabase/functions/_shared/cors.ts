// Frontend (GitHub Pages) and this project's Edge Functions live on different
// domains, so every response needs CORS headers -- see HOW_IT_WORKS.txt / the
// architecture plan for why. Reflect back the origin only if it's one we expect,
// rather than allowing "*", since these endpoints write participant data.
const ALLOWED_ORIGINS = [
    "https://cndcross22.github.io",
    "http://localhost:5500",
    "http://127.0.0.1:5500",
    "http://localhost:8080",
];

export function corsHeaders(origin: string | null): HeadersInit {
    const allowOrigin = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
    return {
        "Access-Control-Allow-Origin": allowOrigin,
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
        "Vary": "Origin",
    };
}

export function handlePreflight(req: Request): Response | null {
    if (req.method !== "OPTIONS") return null;
    return new Response("ok", { headers: corsHeaders(req.headers.get("origin")) });
}

export function jsonResponse(req: Request, status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: {
            ...corsHeaders(req.headers.get("origin")),
            "Content-Type": "application/json",
        },
    });
}
