# ═══════════════════════════════════════════════════════════════
#  OPENCLAW AGENT — RAILWAY DEPLOYMENT GUIDE
#  Celý postup od nuly po živý agent
# ═══════════════════════════════════════════════════════════════

# ──────────────────────────────────────────────────────────────
# KROK 0 — Co budeš potřebovat
# ──────────────────────────────────────────────────────────────
# - GitHub účet                     → github.com
# - Railway účet                    → railway.com (free tier stačí)
# - Anthropic API klíč              → console.anthropic.com
# - (volitelně) Telegram bot token  → @BotFather na Telegramu
# - Telefonní číslo s WhatsApp      → tvoje vlastní číslo


# ──────────────────────────────────────────────────────────────
# KROK 1 — Nahraď router.js (pairing code místo QR)
# ──────────────────────────────────────────────────────────────
# Přejmenuj stávající router.js a vlož nový (viz router-new.js v zipu)
mv router.js router.js.bak
cp router-new.js router.js


# ──────────────────────────────────────────────────────────────
# KROK 2 — Přidej railway.json do rootu projektu
# ──────────────────────────────────────────────────────────────
# Soubor railway.json je přiložen v zipu, jen ho zkopíruj.
# Obsah:
# {
#   "deploy": {
#     "startCommand": "node router.js",
#     "restartPolicyType": "ON_FAILURE"
#   }
# }


# ──────────────────────────────────────────────────────────────
# KROK 3 — Push na GitHub
# ──────────────────────────────────────────────────────────────
git init
git add .
git commit -m "feat: openclaw agent v2 with railway support"

# Vytvoř nové repo na github.com/new, pak:
git remote add origin https://github.com/TVUJ_USERNAME/openclaw-agent.git
git branch -M main
git push -u origin main


# ──────────────────────────────────────────────────────────────
# KROK 4 — Railway: Service pro Agenta
# ──────────────────────────────────────────────────────────────
# 1. Jdi na railway.com → New Project
# 2. Deploy from GitHub repo → vyber openclaw-agent
# 3. Railway automaticky detekuje Node.js a spustí "node router.js"


# ──────────────────────────────────────────────────────────────
# KROK 5 — Railway: Přidat Volume (WhatsApp session persistence)
# ──────────────────────────────────────────────────────────────
# Railway má ephemeral filesystem — session by se smazala po restartu.
# BEZ VOLUME = musíš párovat znovu po každém restartu.
#
# V Railway dashboardu:
# → Klikni na tvoji service
# → záložka "Volumes"
# → Add Volume
#   Mount Path:  /app/baileys_auth_info   ← přesně takto
#   Size:        1 GB (stačí)
# → Add


# ──────────────────────────────────────────────────────────────
# KROK 6 — Railway: Nastavit Environment Variables
# ──────────────────────────────────────────────────────────────
# → Klikni na service → záložka "Variables" → Add Variable
#
# Povinné:
ANTHROPIC_API_KEY     = sk-ant-xxxxxxxxxxxxxxxxxxxx
WA_PHONE_NUMBER       = 420777123456          # BEZ + a mezer, s předvolbou!

# Volitelné:
TELEGRAM_TOKEN        = 123456:ABCdef...      # nech prázdné pokud nechceš Telegram
CLAUDE_MODEL          = claude-opus-4-5
GIT_BRANCH            = main
AGENT_WORKDIR         = /app
WEB_DIR               = /app/web
MEMORY_DIR            = /app/agent-memory

# Pro self-improve (git push z agenta):
GIT_TOKEN             = ghp_xxxxxxxxxxxx      # GitHub Personal Access Token
#   → github.com/settings/tokens → Generate new token (classic)
#   → zaškrtni: repo (full control)
#   → zkopíruj token


# ──────────────────────────────────────────────────────────────
# KROK 7 — Spárování WhatsApp (jen jednou!)
# ──────────────────────────────────────────────────────────────
# Po deploymentu:
# 1. V Railway → service → záložka "Logs"
# 2. Počkej cca 30 sekund na start
# 3. Uvidíš řádek jako:
#       Your pairing code: ABCD-1234
# 4. Na svém telefonu otevři WhatsApp
#    → Propojená zařízení → Propojit zařízení
#    → Zadat kód ručně → zadej ABCD-1234
# 5. V logu se objeví:
#       ✅ WhatsApp connected and ready.
#
# ⚠️  Pairing code platí jen pár minut — zadej ho rychle!
# ⚠️  Díky Volume se session uloží a párovat budeš jen jednou.


# ──────────────────────────────────────────────────────────────
# KROK 8 — Railway: Service pro Web stránku
# ──────────────────────────────────────────────────────────────
# Ve stejném Railway projektu:
# → New Service → Empty Service
# → Settings → Build & Deploy:
#     Start Command:  npx serve web -p $PORT -s
# → Variables:
#     (žádné potřeba — web je statický)
# → Settings → Networking → Generate Domain
#     Dostaneš URL jako: openclaw-web-xxxx.up.railway.app
#
# Alternativa — nasadit web na Vercel/Netlify (je to statický HTML):
# → vercel.com/new → import z GitHub → root directory: web


# ──────────────────────────────────────────────────────────────
# KROK 9 — Nastavit git remote pro self-improve
# ──────────────────────────────────────────────────────────────
# Aby agent mohl commitovat sám sebe, přidej do sub-agents/self-improve.js
# a sub-agents/web-improve.js PŘED git operace:

# (toto přidáš do kódu před git commit volání)
# await execAsync(`git -C "${WORKDIR}" remote set-url origin \
#   https://${process.env.GIT_TOKEN}@github.com/TVUJ_USERNAME/openclaw-agent.git`);

# Pak pushni upravenou verzi:
git add sub-agents/self-improve.js sub-agents/web-improve.js
git commit -m "fix: add git token auth for self-improve"
git push
# Railway automaticky redeployuje po každém push!


# ──────────────────────────────────────────────────────────────
# KROK 10 — Test
# ──────────────────────────────────────────────────────────────
# Pošli si zprávu přes WhatsApp nebo Telegram:

help                          # → zobrazí všechny příkazy
analyze router.js             # → agent přečte a analyzuje soubor
plan deploy nová feature      # → vygeneruje plán
execute napiš hello world     # → agent to fakt udělá, pošle notifikaci
improve                       # → self-improve cyklus → git push
improve web                   # → vylepší web → git push → auto-redeploy


# ──────────────────────────────────────────────────────────────
# VÝSLEDEK
# ──────────────────────────────────────────────────────────────
# ✅ Agent běží 24/7 na Railway (free tier: 500h/měsíc)
# ✅ WhatsApp session přežije restart díky Volume
# ✅ Web dostupný na vygenerované URL
# ✅ Každý "improve web" → Railway automaticky redeployuje nový web
# ✅ Každý "improve" → agent pushne lepší kód → Railway redeployuje sám sebe
#
# Railway Free Tier limity:
# - 500 hodin compute/měsíc (stačí na 1 service nonstop)
# - 1 GB RAM
# - Volumes: 1 GB zdarma
# - Pro 2 services (agent + web) doporučuji Hobby plan ($5/měsíc)
