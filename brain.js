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
        // নিরাপদ math evaluation (শুধু +, -, *, / ও দশমিক সংখ্যা)
function safeMathEval(exprStr) {
    // strict whitelist: digits, spaces, basic operators, parentheses, decimal
    if (!/^[\d\s\+\-\*\/\(\)\.]+$/.test(exprStr)) return null;
    // নিরাপদ: tokens parse করে ক্যালকুলেট করুন
    try {
        // Simple expression with no function calls allowed
        const clean = exprStr.replace(/\s+/g, '');
        // prevent leading ++ or -- exploits
        if (/(\+\+|\-\-)/.test(clean)) return null;
        return Function('"use strict"; return (' + clean + ')')();
    } catch { return null; }
}
const result = safeMathEval(expr[0]);
        if (isNaN(result) || !isFinite(result)) return null;
        return `এর উত্তর হলো: **${result}** 🧮`;
    } catch {
        return null;
    }
}

// ============================================================
// SECTION 8A: DATE / TIME ENGINE
// ইউজার সময়, তারিখ, বার, বাংলা মাস, হিজরি জিজ্ঞেস করলে উত্তর দেবে
// ============================================================

// বাংলা বারের নাম
function _pekoBanglaDay(d) {
    return ["রবিবার","সোমবার","মঙ্গলবার","বুধবার","বৃহস্পতিবার","শুক্রবার","শনিবার"][d];
}

// সময় অনুযায়ী বাংলা পর্যায় (সকাল/দুপুর ইত্যাদি)
function _pekoGreeting(h) {
    if (h >= 4  && h < 12) return "সকাল";
    if (h >= 12 && h < 15) return "দুপুর";
    if (h >= 15 && h < 18) return "বিকাল";
    if (h >= 18 && h < 21) return "সন্ধ্যা";
    return "রাত";
}

// বাংলা সন ও মাস
function _pekoBanglaDate(now) {
    const m = now.getMonth() + 1, d = now.getDate(), y = now.getFullYear();
    const table = [
        { sm:4,sd:14, em:5,sd2:14, name:"বৈশাখ" },
        { sm:5,sd:15, em:6,sd2:14, name:"জ্যৈষ্ঠ" },
        { sm:6,sd:15, em:7,sd2:15, name:"আষাঢ়" },
        { sm:7,sd:16, em:8,sd2:15, name:"শ্রাবণ" },
        { sm:8,sd:16, em:9,sd2:15, name:"ভাদ্র" },
        { sm:9,sd:16, em:10,sd2:15,name:"আশ্বিন" },
        { sm:10,sd:16,em:11,sd2:14,name:"কার্তিক" },
        { sm:11,sd:15,em:12,sd2:14,name:"অগ্রহায়ণ" },
        { sm:12,sd:15,em:1,sd2:13, name:"পৌষ" },
        { sm:1,sd:14, em:2,sd2:12, name:"মাঘ" },
        { sm:2,sd:13, em:3,sd2:13, name:"ফাল্গুন" },
        { sm:3,sd:14, em:4,sd2:13, name:"চৈত্র" },
    ];
    let banglaMonth = "অজানা";
    for (const r of table) {
        if ((m === r.sm && d >= r.sd) || (m === r.em && d <= r.sd2)) {
            banglaMonth = r.name; break;
        }
    }
    const banglaYear = (m < 4 || (m === 4 && d < 14)) ? y - 594 : y - 593;
    return { banglaMonth, banglaYear };
}

// হিজরি/আরবি তারিখ
function _pekoHijriDate(now) {
    const y = now.getFullYear(), mo = now.getMonth() + 1, d = now.getDate();
    const a = Math.floor((14 + 153*(mo+3-12*Math.floor((mo+3)/12))+2)/5)
        + 365*(y+4800-Math.floor((mo+3)/12))
        + Math.floor((y+4800-Math.floor((mo+3)/12))/4)
        - Math.floor((y+4800-Math.floor((mo+3)/12))/100)
        + Math.floor((y+4800-Math.floor((mo+3)/12))/400)
        + d - 32083;
    const l = a - 1948440 + 10632;
    const n = Math.floor((l-1)/10631);
    const l2 = l - 10631*n + 354;
    const j = Math.floor((10985-l2)/5316)*Math.floor((50*l2)/17719)
            + Math.floor(l2/5670)*Math.floor((43*l2)/15238);
    const l3 = l2 - Math.floor((30-j)/15)*Math.floor((17719*j)/50)
             - Math.floor(j/16)*Math.floor((15238*j)/43) + 29;
    const hm = Math.floor((24*l3)/709);
    const hd = l3 - Math.floor((709*hm)/24);
    const hy = 30*n + j - 30;
    const names = ["মুহাররম","সফর","রবিউল আউয়াল","রবিউস সানি",
                   "জুমাদাল উলা","জুমাদাস সানি","রজব","শাবান",
                   "রমজান","শাওয়াল","জুলকাদা","জুলহিজ্জা"];
    return { day: hd, month: names[hm-1] || "", year: hy };
}

// সময়/তারিখ প্রশ্ন কিনা detect করে
const _pekoTimePatterns = [
    /এখন\s*কয়টা/i,/কয়টা\s*বাজে/i,/সময়\s*(কত|বলো|বলুন|জানাও|দাও)/i,
    /time\s*(কত|বলো|দাও)/i,/ঘড়িতে\s*কত/i,/টাইম\s*(কত|বলো|জানাও)/i,
    /এখন\s*কত\s*টা/i,/বাজে\s*কত/i,/what.*time/i,/আজকের\s*সময়/i,
    /আজকে?\s*(কত|কোন)\s*তারিখ/i,/তারিখ\s*(কত|কি|বলো)/i,
    /আজকের\s*তারিখ/i,/date\s*(কত|কি|বলো)/i,/কত\s*তারিখ/i,
    /আজ\s*কত/i,/আজকে?\s*কি?\s*বার/i,/বার\s*(কি|কী|বলো)/i,
    /কোন\s*বার/i,/আজ\s*কি\s*বার/i,/কত\s*সাল/i,/year\s*(কত|কি)/i,
    /বাংলা\s*(মাস|তারিখ|সন|কত)/i,/(আরবি|ইসলামিক|হিজরি)\s*(মাস|তারিখ|সন|কত)/i,
    /এখন\s*(দিন|রাত|সকাল|বিকাল|সন্ধ্যা|দুপুর)/i,
    /এখন\s*কি\s*(দিন|রাত|সকাল)/i,
];

function _pekoIsTimeQuestion(text) {
    return _pekoTimePatterns.some(p => p.test(text));
}

function _pekoTimeAnswer(text) {
    const now   = new Date();
    const h     = now.getHours();
    const m     = now.getMinutes();
    const s     = now.getSeconds();
    const mn    = String(m).padStart(2,"0");
    const greet = _pekoGreeting(h);
    const day   = _pekoBanglaDay(now.getDay());
    const date  = now.getDate();
    const emo   = now.getMonth()+1;
    const yr    = now.getFullYear();
    const { banglaMonth, banglaYear } = _pekoBanglaDate(now);
    const hijri = _pekoHijriDate(now);
    const t     = text.toLowerCase();

    const wTime    = /কয়টা|বাজে|সময়|time|টাইম|ঘড়ি/.test(t);
    const wDate    = /তারিখ|date|কত\s*তারিখ|আজ\s*কত/.test(t);
    const wDay     = /বার|day/.test(t);
    const wYear    = /সাল|year/.test(t);
    const wBangla  = /বাংলা/.test(t);
    const wHijri   = /(আরবি|ইসলামিক|হিজরি)/.test(t);
    const wPeriod  = /(দিন|রাত|সকাল|বিকাল|সন্ধ্যা|দুপুর)/.test(t);
    const wantAll  = !wTime && !wDate && !wDay && !wYear && !wBangla && !wHijri && !wPeriod;

    if (wantAll) {
        // সব একসাথে
        return `🕐 এখন ${greet} ${h%12||12}:${mn} ${h>=12?"PM":"AM"} বাজে\n` +
               `📅 আজ ${day}, ${date}/${emo}/${yr} (ইংরেজি)\n` +
               `🇧🇩 বাংলা: ${banglaMonth} মাস, ${banglaYear} বঙ্গাব্দ\n` +
               `☪️ হিজরি: ${hijri.day} ${hijri.month}, ${hijri.year}`;
    }

    const parts = [];
    if (wTime)   parts.push(`🕐 এখন ${greet} ${h%12||12}:${mn} ${h>=12?"PM":"AM"} বাজে।`);
    if (wPeriod && !wTime) parts.push(`🌤️ এখন ${greet}।`);
    if (wDay)    parts.push(`📅 আজ ${day}।`);
    if (wDate)   parts.push(`🗓️ আজকের তারিখ: ${date}/${emo}/${yr} (ইংরেজি)।`);
    if (wYear)   parts.push(`📆 বর্তমান সাল: ${yr}।`);
    if (wBangla) parts.push(`🇧🇩 বাংলা: ${banglaMonth} মাস, ${banglaYear} বঙ্গাব্দ।`);
    if (wHijri)  parts.push(`☪️ হিজরি: ${hijri.day} ${hijri.month}, ${hijri.year} হিজরি।`);
    return parts.join("\n");
}

// ============================================================
// SECTION 8B: SPAM / DUPLICATE DETECTOR
// একই ইউজার ৬০ সেকেন্ডের মধ্যে ২+ বার একই প্রশ্ন করলে soft-funny জবাব
// ============================================================

const _pekoSpamLog = {}; // key: userId+question → timestamps[]

const _pekoFunnyReplies = [
    "আরে ভাই, এই প্রশ্ন তো একটু আগেই করলেন! 😄 আমি ভুলে যাইনি!",
    "হাহা, মনে হচ্ছে আপনি পরীক্ষা করছেন? 😊 একটু আগেই উত্তর দিলাম!",
    "ওহো! একই প্রশ্ন আবার? 😅 চিন্তা নেই, একই উত্তর দিচ্ছি —",
    "আপনি কি নিশ্চিত হতে চাইছেন? 😄 উত্তর আগেরটাই! —",
    "এই প্রশ্নটা কিছুক্ষণ আগেও এসেছিল! 😊 তবুও আবার জানাচ্ছি —",
];

// return: null (নতুন প্রশ্ন) অথবা funny string (spam হলে)
function _pekoSpamCheck(userId, question) {
    const key = (userId || "guest") + "_" + question.toLowerCase().trim().slice(0, 80);
    const now = Date.now();
    if (!_pekoSpamLog[key]) _pekoSpamLog[key] = [];
    _pekoSpamLog[key] = _pekoSpamLog[key].filter(t => now - t < 60000);
    // খালি array হলে key মুছে দাও — memory leak প্রতিরোধ
    if (_pekoSpamLog[key].length === 0 && Object.keys(_pekoSpamLog).length > 500) {
        delete _pekoSpamLog[key];
        _pekoSpamLog[key] = [];
    }
    const count = _pekoSpamLog[key].length;
    _pekoSpamLog[key].push(now);
    if (count >= 1) {
        return _pekoFunnyReplies[Math.floor(Math.random() * _pekoFunnyReplies.length)];
    }
    return null;
}

// ============================================================
// SECTION 8: MAIN ANSWER FUNCTION
// এটাই মূল ফাংশন যেটা index.html থেকে কল করতে হবে
// ============================================================

async function pekoGetSmartAnswer(userQuestion, userName, userId) {
    if (!userQuestion || !userQuestion.trim()) return "কিছু জিজ্ঞেস করুন! 😊";

    // ── ১. সময়/তারিখ প্রশ্ন? সাথে সাথে উত্তর ──
    if (_pekoIsTimeQuestion(userQuestion)) {
        const dtAnswer = _pekoTimeAnswer(userQuestion);
        pekoRememberMessage("bot", dtAnswer);
        return dtAnswer;
    }

    // ── ২. Spam চেক ──
    const spamMsg = _pekoSpamCheck(userId, userQuestion);

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
        const finalAnswer = spamMsg
            ? spamMsg + "\n\n" + brainResult.answer
            : brainResult.answer;
        pekoRememberMessage("bot", finalAnswer);
        return finalAnswer;
    }

    // কিছু না পেলে default
    const defaultReply = pekoBuiltinReply("unknown", userName);
    const finalDefault = spamMsg ? spamMsg + "\n\n" + defaultReply : defaultReply;
    pekoRememberMessage("bot", finalDefault);
    return finalDefault;
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