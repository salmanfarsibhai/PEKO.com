// ==========================================
// 👑 PEKO AI CORE ROUTER INTERCEPTOR
// ==========================================
const PekoRouter = {
    getMode: function() {
        const mode = localStorage.getItem('peko_ai_routing_mode');
        return mode ? mode : 'on'; // 'on' = Firebase, 'off' = Groq API
    },
    setMode: function(mode) {
        localStorage.setItem('peko_ai_routing_mode', mode);
    }
};