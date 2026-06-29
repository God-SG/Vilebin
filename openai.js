import OpenAI from "openai";

const openai = new OpenAI({
    apiKey: 'sk-...' // CHAT GPT API KEY
});

const MAX_PASTE_LENGTH = 2000;

function cleanPaste(text) {
    return text
        .replace(/[\u2590-\u259F\u2800-\u28FF\u25A0-\u25FF\u2600-\u26FF█░⠁-⠿✧]/g, '')
        .replace(/[\r\n]{2,}/g, '\n')
        .trim();
}

function calculateAge(dob) {
    const [d, m, y] = dob.split('.').map(Number);
    const today = new Date();
    let age = today.getFullYear() - y;
    if (today.getMonth() + 1 < m || (today.getMonth() + 1 === m && today.getDate() < d)) age--;
    return age;
}

function buildPrompt(cleanedText) {
    const today = new Date().toISOString().split('T')[0];
    const dobMatches = cleanedText.match(/\d{2}\.\d{2}\.\d{4}/g) || [];
    const ageLines = dobMatches.map(dob => `${dob} = ${calculateAge(dob)} лет`).join('\n');

    return `You are a strict paste moderation bot. Today: ${today}.
Return JSON only. No markdown. No explanations outside JSON.

Pre-calculated ages (TRUST THESE, do not recalculate):
${ageLines ? ageLines + '\n' : ''}

Rules (ONLY these violation types allowed):
1. underage — main subject's pre-calculated age is BELOW 15. Age 15 or higher is NOT a violation.
2. repost — exact duplicate of another paste
3. cp — contains sexual content of a person under 18, OR contains links/references to CP material. Mere personal information (name, birthday, location, emails, phones, social links) about a person under 18 is NOT CP.
4. spam — paste is entirely ads, spam, promotional content, OR completely irrelevant/meaningless content (random characters, gibberish, unrelated text)
5. bot_output — paste is clearly AI/bot generated output
6. lack_of_effort — paste is random characters, gibberish, meaningless text, OR has fewer than 2 of: full name, email, phone, address, date of birth

Violation priority:
cp > underage > spam > lack_of_effort > bot_output > repost

IMPORTANT:
- Only flag violations that clearly exist in the paste.
- Do NOT invent violations.
- Personal information about minors without sexual content or CP links is NOT a violation.
- Random symbols or gibberish = lack_of_effort.
- If uncertain, return violation null with a lower confidence score.
- Confidence must reflect how certain you are that a violation exists:
- 1.0 = absolutely certain
- 0.75 = likely
- 0.5 = uncertain
- 0.25 = unlikely
- 0.0 = certain there is no violation
Use lower numbers if violation is borderline or only partially present.
Reason formatting:
Write the reason as a short moderation explanation similar to:
"Content lacks clear dox information and appears to be irrelevant or spam with unrelated screenshots and phrases."
Avoid casual language. Use professional moderation wording.
Return format:
{"violation": "underage" | "repost" | "cp" | "spam" | "bot_output" | "lack_of_effort" | null, "confidence": number, "reason": "moderation explanation sentence" | null}

Paste:
${cleanedText}`;
}

export async function AiCheckPaste(pasteText) {
    const cleaned = cleanPaste(pasteText);
    const truncated = cleaned.length > MAX_PASTE_LENGTH
        ? cleaned.slice(0, MAX_PASTE_LENGTH)
        : cleaned;

    let response;
    try {
        response = await openai.responses.create({
            model: "gpt-4.1-mini",
            input: buildPrompt(truncated),
            store: true
        });
    } catch {
        return { violation: null, confidence: 0, reason: null, error: true };
    }

    try {
        return JSON.parse(response.output_text);
    } catch {
        return { violation: null, confidence: 0, reason: null };
    }
}