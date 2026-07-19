export interface GuardianDigestEmail {
  to: string;
  subject: string;
  text: string;
}

export async function sendGuardianDigestEmail(input: {
  apiKey: string;
  from: string;
  email: GuardianDigestEmail;
  fetcher?: typeof fetch;
}): Promise<{ providerMessageId: string }> {
  if (!input.apiKey || !input.from) throw new Error("Weekly guardian email is not configured.");
  const response = await (input.fetcher ?? fetch)("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${input.apiKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({ from: input.from, to: [input.email.to], subject: input.email.subject, text: input.email.text })
  });
  if (!response.ok) throw new Error("The weekly guardian email provider rejected the delivery.");
  const body = await response.json() as { id?: unknown };
  if (typeof body.id !== "string" || !body.id) throw new Error("The weekly guardian email provider returned an invalid receipt.");
  return { providerMessageId: body.id };
}
