// ============================================================
// 👑 PEKO AI MULTI-API KEY ROTATOR ENGINE (UP TO 20 KEYS)
// ফাইলের নাম: external_api.js
// ============================================================

const GROQ_KEYS_POOL = [
    "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", // ১ নম্বর কী
    "", // ২ নম্বর কী
    "", // ৩ নম্বর কী
    // ... আপনার বাকি খালি স্পেসগুলো থাকবে
];

// 🎯 মোবাইল ফিক্স: লোকাল স্টোরেজ চেক করার সময় NaN (Not a Number) হ্যান্ডলিং নিশ্চিত করা
let savedIndex = localStorage.getItem('peko_current_key_index');
let currentKeyIndex = (savedIndex && !isNaN(parseInt(savedIndex))) ? parseInt(savedIndex) : 0;

async function fetchExternalAIResponse(userQuestion) {
    const validKeys = GROQ_KEYS_POOL.filter(key => key && key.trim() !== "");

    if (validKeys.length === 0) {
        return "⚠️ সিস্টেমে কোনো বৈধ API KEY খুঁজে পাওয়া যায়নি। দয়া করে অ্যাডমিন প্যানেল চেক করুন।";
    }

    // ইনডেক্স বাউন্ডারি চেক (মোবাইল ও ডেক্সটপ সেফটি)
    if (isNaN(currentKeyIndex) || currentKeyIndex >= validKeys.length || currentKeyIndex < 0) {
        currentKeyIndex = 0;
        localStorage.setItem('peko_current_key_index', 0);
    }

    let activeKey = validKeys[currentKeyIndex];
    let attempts = 0;

    while (attempts < validKeys.length) {
        try {
            // মোবাইল ব্রাউজার রিকোয়েস্ট সিঙ্ক করার জন্য পারফেক্ট হেডার স্ট্রাকচার
            const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${activeKey}`
                },
                body: JSON.stringify({
                    model: "mixtral-8x7b-32768", // অথবা আপনার ব্যবহৃত নির্দিষ্ট মডেল আইডি
                    messages: [{ role: "user", content: userQuestion }]
                })
            });

            // কী-এর লিমিট শেষ হলে (429) বা কি ব্লক হলে (401) পরবর্তী কী-তে অটো সুইচ
            if (res.status === 429 || res.status === 401) {
                currentKeyIndex = (currentKeyIndex + 1) % validKeys.length;
                if (isNaN(currentKeyIndex)) currentKeyIndex = 0; // ফলব্যাক
                localStorage.setItem('peko_current_key_index', currentKeyIndex);
                activeKey = validKeys[currentKeyIndex];
                attempts++;
                continue;
            }

            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                return "❌ সমস্যা হয়েছে: " + (err?.error?.message || "API error: " + res.status);
            }

            const data = await res.json();
            return data?.choices?.[0]?.message?.content?.trim() || "কোনো উত্তর পাওয়া যায়নি ভাই।";

        } catch (e) {
            console.error("Network Error with current key, trying next...", e);
            currentKeyIndex = (currentKeyIndex + 1) % validKeys.length;
            if (isNaN(currentKeyIndex)) currentKeyIndex = 0; // সেফটি রিকভারি
            localStorage.setItem('peko_current_key_index', currentKeyIndex);
            activeKey = validKeys[currentKeyIndex];
            attempts++;
        }
    }

    return "⚡ আপাতত সবগুলো API Key-এর লিমিট শেষ ভাই। একটু পর আবার ট্রাই করুন।";
}
