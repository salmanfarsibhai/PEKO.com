// ============================================================
// 👑 PEKO AI MULTI-API KEY ROTATOR ENGINE (UP TO 20 KEYS)
// ফাইলের নাম: external_api.js
// ============================================================

// সালমান ভাই, এখানে আপনি সর্বোচ্চ ২০টি API Key একসাথে সাজিয়ে রাখতে পারবেন।
const GROQ_KEYS_POOL = [
    "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", // ১ নম্বর কী (আপনার বর্তমান সচল কী)
    "sk-3b92fb131aeb45d1bc9cb5661bd88ce8", // ২ নম্বর কী (ভবিষ্যতে মন চাইলে এখানে বসাবেন)
    "sk-9ebbc3f7aab941efa2c444833cc6f7dc", // ৩ নম্বর কী
    "", // ৪ নম্বর কী
    "", // ৫ নম্বর কী
    "", // ৬ নম্বর কী
    "", // ৭ নম্বর কী
    "", // ৮ নম্বর কী
    "", // ৯ নম্বর কী
    "", // ১০ নম্বর কী
    "", // ১১ নম্বর কী
    "", // ১২ নম্বর কী
    "", // ১৩ নম্বর কী
    "", // ১৪ নম্বর কী
    "", // ১৫ নম্বর কী
    "", // ১৬ নম্বর কী
    "", // ১৭ নম্বর কী
    "", // ১৮ নম্বর কী
    "", // ১৯ নম্বর কী
    ""  // ২০ নম্বর কী
];

// বর্তমানে কোন কী-টি রান হচ্ছে তা ট্র্যাক করার ইনডেক্স (লোকাল মেমরিতে থাকবে)
let currentKeyIndex = parseInt(localStorage.getItem('peko_current_key_index')) || 0;

async function fetchExternalAIResponse(userQuestion) {
    // শুধুমাত্র সচল এবং ভ্যালিড কী-গুলোকে ফিল্টার করে নেওয়া হচ্ছে (খালি ঘরগুলো বাদ যাবে)
    const validKeys = GROQ_KEYS_POOL.filter(key => key && key.trim() !== "");

    // যদি লিস্টে কোনো কী-ই না থাকে বা সব কী খালি থাকে
    if (validKeys.length === 0) {
        return "⚠️ সিস্টেমে কোনো বৈধ API KEY খুঁজে পাওয়া যায়নি। দয়া করে অ্যাডমিন প্যানেল চেক করুন।";
    }

    // ইনডেক্স যদি কোনো কারণে লিস্টের চেয়ে বড় হয়ে যায় তবে আবার ০ থেকে শুরু হবে
    if (currentKeyIndex >= validKeys.length) {
        currentKeyIndex = 0;
        localStorage.setItem('peko_current_key_index', 0);
    }

    // বর্তমান সচল কী-টি সিলেক্ট করা হলো
    let activeKey = validKeys[currentKeyIndex];
    let attempts = 0; // কতবার ট্রাই করা হলো তার কাউন্টার

    // লিস্টে যতগুলো কী আছে, সর্বোচ্চ ততবার লুপ ঘুরিয়ে সচল কী খোঁজা হবে
    while (attempts < validKeys.length) {
        try {
            console.log(`Trying Groq API Key Index: ${currentKeyIndex}...`);

            const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": "Bearer " + activeKey
                },
                body: JSON.stringify({
                    model: "llama-3.3-70b-versatile",
                    max_tokens: 600,
                    messages: [
                        {
                            role: "system",
                            content: "তুমি PEKO AI, একটি বাংলা AI সহকারী। সবসময় বাংলায় উত্তর দেবে। সহজ, সংক্ষিপ্ত ও বন্ধুত্বপূর্ণভাবে কথা বলবে।"
                        },
                        { role: "user", content: userQuestion }
                    ]
                })
            });

            // যদি লিমিট শেষ হয়ে যায় (Rate Limit / Too Many Requests - 429 Error)
            if (res.status === 429) {
                console.warn(`Key Index ${currentKeyIndex} has hit its limit (429). Switching to next key...`);

                // পরবর্তী কী-তে মুভ করা হচ্ছে
                currentKeyIndex = (currentKeyIndex + 1) % validKeys.length;
                localStorage.setItem('peko_current_key_index', currentKeyIndex);
                activeKey = validKeys[currentKeyIndex];
                attempts++;
                continue; // লুপের শুরুতে গিয়ে নতুন কী দিয়ে আবার ট্রাই করবে
            }

            // যদি অন্য কোনো সার্ভার এরর আসে
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                return "❌ সমস্যা হয়েছে: " + (err?.error?.message || "API error: " + res.status);
            }

            // সফলভাবে উত্তর পাওয়া গেলে তা রিটার্ন করবে
            const data = await res.json();
            return data?.choices?.[0]?.message?.content?.trim() || "কোনো উত্তর পাওয়া যায়নি ভাই।";

        } catch (e) {
            console.error("Network Error with current key, trying next...", e);
            // নেটওয়ার্ক ফেইলুর হলেও পরবর্তী কী-তে অটো সুইচ করবে
            currentKeyIndex = (currentKeyIndex + 1) % validKeys.length;
            localStorage.setItem('peko_current_key_index', currentKeyIndex);
            activeKey = validKeys[currentKeyIndex];
            attempts++;
        }
    }

    // যদি লিস্টে থাকা সব কটি কী-র লিমিটই একসাথে শেষ হয়ে যায় (বা আপনার বর্তমান ১টি মাত্র কী-র লিমিট শেষ হয় এবং আর কোনো কী না থাকে)
    return "⚡ আপাতত কথা বলার দরকার নেই ভাই, আমার দৈনিক লিমিট শেষ হয়ে গেছে! দয়া করে কিছু সময় পর আবার চেষ্টা করুন।";
}