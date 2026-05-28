// ============================================================
// 🧠 PEKO AI BRAIN ENGINE v1.0
// ফাইলের নাম: brain.js
// এই ফাইলটি index.html-এ <script src="brain.js"></script> দিয়ে লোড করুন
// Firebase Realtime Database ব্যবহার করে ডাটা স্টোর ও রিট্রিভ করে
// কোনো বাইরের AI API ছাড়াই কাজ করে
// ============================================================

// ============================================================
// SECTION 1: CORE CONFIG
// ============================================================

const PEKO_BRAIN = {
    version: "1.0.0",
    name: "PEKO Brain",
    dbRef: "peko_brain", // Firebase-এ এই নোডে সব ডাটা থাকবে
    contextMemory: [], // বর্তমান চ্যাটের স্মৃতি (session)
    maxContext: 10,    // কতটা পুরনো মেসেজ মনে রাখবে
};

// ============================================================
// SECTION 2: TEXT PROCESSING UTILITIES
// ============================================================

// বাংলা ও ইংরেজি উভয় ভাষার টেক্সট নরমালাইজ করে
function pekoNormalize(text) {
    if (!text) return "";
    return text
        .toLowerCase()
        .trim()
        .replace(/[।!?,.]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

// টেক্সট থেকে কীওয়ার্ড বের করে
function pekoExtractKeywords(text) {
    const stopWords = [
        "আমি", "তুমি", "সে", "আমার", "তোমার", "আছে", "আছি", "হয়", "হচ্ছে",
        "এটা", "ওটা", "কি", "কী", "কেন", "কিভাবে", "কখন", "কোথায়",
        "the", "a", "an", "is", "are", "was", "were", "be", "been",
        "i", "you", "he", "she", "it", "we", "they", "my", "your",
        "what", "how", "why", "when", "where", "which", "who"
    ];
    const words = pekoNormalize(text).split(" ");
    return words.filter(w => w.length > 1 && !stopWords.includes(w));
}

// দুটো টেক্সটের মিল স্কোর বের করে (০ থেকে ১)
function pekoSimilarityScore(text1, text2) {
    const kw1 = new Set(pekoExtractKeywords(text1));
    const kw2 = new Set(pekoExtractKeywords(text2));
    if (kw1.size === 0 || kw2.size === 0) return 0;

    let matchCount = 0;
    kw1.forEach(w => { if (kw2.has(w)) matchCount++; });

    const unionSize = new Set([...kw1, ...kw2]).size;
    return matchCount / unionSize; // Jaccard Similarity
}

// ============================================================
// SECTION 3: CONTEXT MEMORY ENGINE
// চ্যাটে কে কি বলেছে সেটা মনে রাখে
// ============================================================

function pekoRememberMessage(role, text) {
    PEKO_BRAIN.contextMemory.push({ role, text, time: Date.now() });
    if (PEKO_BRAIN.contextMemory.length > PEKO_BRAIN.maxContext) {
        PEKO_BRAIN.contextMemory.shift(); // সবচেয়ে পুরনোটা বাদ
    }
}

// context থেকে ইউজারের পূর্ববর্তী কথা খোঁজে
function pekoGetContextHint() {
    const userMsgs = PEKO_BRAIN.contextMemory
        .filter(m => m.role === "user")
        .map(m => m.text);
    return userMsgs.join(" ");
}

// ============================================================
// SECTION 4: FIREBASE DATA FETCHER
// brain_data নোড থেকে ট্রেনড ডাটা রিড করে
// ============================================================

async function pekoFetchBrainData() {
    return new Promise((resolve) => {
        if (typeof DB === "undefined") { resolve([]); return; }
        DB.ref(PEKO_BRAIN.dbRef + "/qa_pairs")
            .once("value")
            .then(snapshot => {
                if (!snapshot.exists()) { resolve([]); return; }
                const pairs = [];
                snapshot.forEach(child => {
                    pairs.push({ id: child.key, ...child.val() });
                });
                resolve(pairs);
            })
            .catch(() => resolve([]));
    });
}

// ============================================================
// SECTION 5: SMART SEARCH ENGINE
// ট্রেনড ডাটা থেকে সবচেয়ে মিলে এমন উত্তর খোঁজে
// ============================================================

async function pekoSearchBrain(userQuestion) {
    const allPairs = await pekoFetchBrainData();
    if (!allPairs || allPairs.length === 0) return null;

    const contextHint = pekoGetContextHint();
    const combinedQuery = userQuestion + " " + contextHint;

    let bestMatch = null;
    let bestScore = 0;
    const THRESHOLD = 0.18; // এর কম স্কোর হলে উত্তর দেবে না

    allPairs.forEach(pair => {
        if (!pair.question || !pair.answer) return;

        // প্রশ্নের সাথে সরাসরি মিল
        let score = pekoSimilarityScore(userQuestion, pair.question);

        // ট্যাগ থাকলে ট্যাগের সাথেও মিলাবে
        if (pair.tags && Array.isArray(pair.tags)) {
            const tagText = pair.tags.join(" ");
            const tagScore = pekoSimilarityScore(userQuestion, tagText);
            score = Math.max(score, tagScore * 0.8);
        }

        // context সহ মিলালে বোনাস স্কোর
        const ctxScore = pekoSimilarityScore(combinedQuery, pair.question);
        score = Math.max(score, ctxScore * 0.7);

        // ব্যবহার বেশি হওয়া উত্তরকে সামান্য বোনাস
        if (pair.useCount && pair.useCount > 5) {
            score += 0.05;
        }

        if (score > bestScore && score >= THRESHOLD) {
            bestScore = score;
            bestMatch = pair;
        }
    });

    // ব্যবহার গণনা আপডেট
    if (bestMatch && typeof DB !== "undefined") {
        const currentCount = bestMatch.useCount || 0;
        DB.ref(PEKO_BRAIN.dbRef + "/qa_pairs/" + bestMatch.id)
            .update({ useCount: currentCount + 1 })
            .catch(() => {});
    }

    return bestMatch;
}

// ============================================================
// SECTION 6: TOPIC DETECTOR
// প্রশ্নের বিষয় ধরতে পারে (greeting, math, general ইত্যাদি)
// ============================================================

function pekoDetectTopic(text) {
    const lower = pekoNormalize(text);

    const greetings = ["hello", "hi", "hey", "হ্যালো", "হাই", "হেই", "কেমন আছ", "আস্সালামু", "সালাম"];
    const thanks = ["ধন্যবাদ", "থ্যাংক", "thank", "thanks", "শুকরিয়া", "আল্লাহ"];
    const farewells = ["বিদায়", "bye", "goodbye", "আল্লাহ হাফেজ", "দেখা হবে"];
    const mathPattern = /[\d]+\s*[\+\-\*\/]\s*[\d]+/;
    const questionWords = ["কি", "কী", "কেন", "কিভাবে", "কখন", "কোথায়", "what", "how", "why", "when", "where"];

    if (greetings.some(g => lower.includes(g))) return "greeting";
    if (thanks.some(t => lower.includes(t))) return "thanks";
    if (farewells.some(f => lower.includes(f))) return "farewell";
    if (mathPattern.test(lower)) return "math";
    if (questionWords.some(q => lower.includes(q))) return "question";
    return "general";
}

// ============================================================
// SECTION 7: BUILT-IN RESPONSE SYSTEM
// Firebase ডাটা না পেলে এই default উত্তরগুলো কাজ করবে
// ============================================================

function pekoBuiltinReply(topic, userName) {
    const name = userName || "বন্ধু";

    const replies = {
        greeting: [
            `হ্যালো ${name}! 😊 আজকে কেমন আছেন?`,
            `আরে ${name}! স্বাগতম! কী জানতে চান?`,
            `হ্যালো! 👋 আমি PEKO, আপনার AI সহকারী।`
        ],
        thanks: [
            "আপনাকে সাহায্য করতে পেরে ভালো লাগলো! 😊",
            "ধন্যবাদ আপনাকেও! কিছু আর জানতে চান?",
            "আমার কাজই হলো আপনাকে সাহায্য করা! 🤝"
        ],
        farewell: [
            "ভালো থাকবেন! আবার কথা হবে। 😊",
            "আল্লাহ হাফেজ! যেকোনো প্রশ্নে আবার আসবেন।",
            "বিদায়! সুস্থ ও সুন্দর থাকবেন। 👋"
        ],
        unknown: [
            `${name}, এই বিষয়ে আমাকে আরও শেখানো হয়নি। শীঘ্রই আপডেট আসবে!`,
            "এই প্রশ্নের উত্তর আমার কাছে এখনো নেই, তবে আমি শিখছি!",
            "আমি এখনো এটা শিখিনি। আমার ট্রেনারকে বলুন আমাকে শেখাতে! 📚"
        ]
    };

    const arr = replies[topic] || replies.unknown;
    return arr[Math.floor(Math.random() * arr.length)];
}

// সহজ গণিত সমাধান
function pekoSolveMath(text) {
    try {
        const expr = text.match(/[\d\s\+\-\*\/\(\)\.]+/);
        if (!expr) return null;
        const result = Function('"use strict"; return (' + expr[0] + ')')();
        if (isNaN(result) || !isFinite(result)) return null;
        return `এর উত্তর হলো: **${result}** 🧮`;
    } catch {
        return null;
    }
}

// ============================================================
// SECTION 8: MAIN ANSWER FUNCTION
// এটাই মূল ফাংশন যেটা index.html থেকে কল করতে হবে
// ============================================================

async function pekoGetSmartAnswer(userQuestion, userName) {
    if (!userQuestion || !userQuestion.trim()) return "কিছু জিজ্ঞেস করুন! 😊";

    // স্মৃতিতে রাখুন
    pekoRememberMessage("user", userQuestion);

    const topic = pekoDetectTopic(userQuestion);

    // Greeting, thanks, farewell এর জন্য সাথে সাথে উত্তর
    if (topic === "greeting" || topic === "thanks" || topic === "farewell") {
        const reply = pekoBuiltinReply(topic, userName);
        pekoRememberMessage("bot", reply);
        return reply;
    }

    // গণিত চেক
    if (topic === "math") {
        const mathResult = pekoSolveMath(userQuestion);
        if (mathResult) {
            pekoRememberMessage("bot", mathResult);
            return mathResult;
        }
    }

    // Firebase ব্রেইন সার্চ
    const brainResult = await pekoSearchBrain(userQuestion);
    if (brainResult && brainResult.answer) {
        pekoRememberMessage("bot", brainResult.answer);
        return brainResult.answer;
    }

    // কিছু না পেলে default
    const defaultReply = pekoBuiltinReply("unknown", userName);
    pekoRememberMessage("bot", defaultReply);
    return defaultReply;
}

// ============================================================
// SECTION 9: FEEDBACK SYSTEM
// ইউজার ভালো উত্তরে 👍 দিলে সেটা রেকর্ড হবে
// ============================================================

function pekoSaveFeedback(questionId, isPositive) {
    if (typeof DB === "undefined" || !questionId) return;
    DB.ref(PEKO_BRAIN.dbRef + "/qa_pairs/" + questionId)
        .once("value")
        .then(snap => {
            if (!snap.exists()) return;
            const current = snap.val();
            const upvotes = (current.upvotes || 0) + (isPositive ? 1 : 0);
            const downvotes = (current.downvotes || 0) + (isPositive ? 0 : 1);
            DB.ref(PEKO_BRAIN.dbRef + "/qa_pairs/" + questionId)
                .update({ upvotes, downvotes });
        });
}

// ============================================================
// SECTION 10: SESSION RESET
// নতুন চ্যাট শুরু হলে context মেমোরি ক্লিয়ার করুন
// ============================================================

function pekoResetSession() {
    PEKO_BRAIN.contextMemory = [];
}

// ============================================================
// EXPORT: window-এ assign করা হলো যাতে index.html ব্যবহার করতে পারে
// ============================================================

window.pekoGetSmartAnswer = pekoGetSmartAnswer;
window.pekoResetSession = pekoResetSession;
window.pekoSaveFeedback = pekoSaveFeedback;
window.PEKO_BRAIN = PEKO_BRAIN;