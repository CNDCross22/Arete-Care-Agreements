// Microsoft Graph email sending (app-only, client-credentials flow) -- see
// the architecture plan's "Microsoft Graph email integration" section.
// GRAPH_TENANT_ID / GRAPH_CLIENT_ID / GRAPH_CLIENT_SECRET / GRAPH_SENDER_EMAIL
// are Supabase Edge Function secrets (never committed to the repo). The app
// authenticates as itself (not a signed-in user), so there is no login step
// here and no distinction Graph makes between internal/external recipients --
// whether mail actually lands externally depends on the tenant's own mail
// flow/DLP rules, not anything configured in this app.
interface SendEmailOptions {
    to: string;
    subject: string;
    html: string;
    attachment?: { name: string; contentBytes: string; contentType?: string };
}

// Escape anything user-supplied (names, etc.) before interpolating it into an
// email's HTML body, so stray angle brackets can't break or inject into it.
export function escapeHtml(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

async function getGraphToken(): Promise<string> {
    const tenantId = Deno.env.get("GRAPH_TENANT_ID")!;
    const clientId = Deno.env.get("GRAPH_CLIENT_ID")!;
    const clientSecret = Deno.env.get("GRAPH_CLIENT_SECRET")!;

    const response = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
            grant_type: "client_credentials",
            client_id: clientId,
            client_secret: clientSecret,
            scope: "https://graph.microsoft.com/.default",
        }),
    });

    const body = await response.json();
    if (!response.ok) {
        throw new Error(`Could not get a Graph token: ${body.error_description || body.error || response.status}`);
    }
    return body.access_token as string;
}

export async function sendGraphEmail({ to, subject, html, attachment }: SendEmailOptions): Promise<void> {
    const senderEmail = Deno.env.get("GRAPH_SENDER_EMAIL")!;
    const token = await getGraphToken();

    const message: Record<string, unknown> = {
        subject,
        body: { contentType: "HTML", content: html },
        toRecipients: [{ emailAddress: { address: to } }],
    };

    if (attachment) {
        message.attachments = [
            {
                "@odata.type": "#microsoft.graph.fileAttachment",
                name: attachment.name,
                contentType: attachment.contentType || "application/pdf",
                contentBytes: attachment.contentBytes,
            },
        ];
    }

    const response = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(senderEmail)}/sendMail`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ message, saveToSentItems: true }),
    });

    if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Graph sendMail failed (${response.status}): ${errorBody}`);
    }
}
