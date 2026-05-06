# Návrh update a nových funkcí pro OpenClaw

## 1) Priority na další 2–4 týdny (Quick Wins)

1. **Bezpečné schvalování akcí v chatu (Human-in-the-loop)**
   - Přidat režim „confirm before execute“ pro příkazy typu `execute` a `improve`.
   - Agent nejdřív pošle plán + odhad rizika a čeká na `approve / reject`.
   - Přínos: menší šance nechtěných změn při zachování rychlosti.

2. **Lepší observabilita a audit logy**
   - Strukturované logy (JSON) s korelačním ID na jednu konverzaci/úkol.
   - Jednoduchý audit trail: kdo spustil příkaz, jaký byl plán, výsledek, chyby.
   - Přínos: snadnější debugging i provoz na Railway.

3. **Healthcheck + readiness endpoint**
   - Přidat `/healthz` a `/readyz` endpointy s kontrolou: env, provider dostupnost, paměť.
   - Přínos: lepší monitoring, rychlejší odhalení výpadků.

4. **Rozšířený `status` command**
   - Kromě provideru/modelu přidat uptime, počet aktivních úkolů, poslední chybu, verzi commitu.
   - Přínos: okamžitý přehled v Telegram/WhatsApp bez přihlášení do logů.

---

## 2) Produktové funkce s vysokým dopadem

1. **Skill/plugin registry pro sub-agenty**
   - Zaveďte registr schopností (planner/executor/memory/web-improve) s metadata: vstupy, výstupy, limity.
   - Umožní to dynamicky zapínat/vypínat schopnosti bez zásahu do jádra.

2. **Per-user sandbox profily**
   - Každému uživateli/kanálu přiřadit profil oprávnění (`read-only`, `safe-write`, `full-private`).
   - Zabrání to tomu, aby jeden “odvážný” prompt otevřel příliš široké pravomoci.

3. **Paměť se score relevance + expirací**
   - U session paměti přidat `importance`, `last_used_at`, `ttl_days`.
   - Staré/nízkohodnotné položky archivovat a shrnovat.
   - Zlepší kvalitu odpovědí i náklady na kontext.

4. **Asynchronní fronta úkolů + retry policy**
   - Spouštět delší úkoly přes queue (s lockem na user/session).
   - Retry s backoffem pro nestabilní API volání.
   - Přínos: robustnější provoz při špičkách.

---

## 3) Technické zlepšení architektury

1. **Unifikace routerů**
   - Repo obsahuje více variant routeru (`router.js`, `router-all.js`, `router-stable.js`, ...).
   - Doporučení: jeden hlavní router + feature flags místo paralelních entrypointů.
   - Přínos: menší maintenance overhead, méně regresí.

2. **Standardizace kontraktů mezi sub-agenty**
   - Definovat JSON schema pro planner output a executor input.
   - Validace na hranici každého sub-agenta.
   - Přínos: méně “tichých” chyb a jednodušší refactoring.

3. **Circuit breakers na LLM providery**
   - Když provider vrací chyby/timeouty, dočasně přepnout na fallback model/provider.
   - Přínos: vyšší dostupnost botu.

4. **Idempotentní self-improve pipeline**
   - Jednoznačný run ID, lock soubor, detekce duplicate run.
   - Přínos: eliminuje race conditions při opakovaném spuštění.

---

## 4) Bezpečnost a governance

1. **Policy engine pro risky operace**
   - Pravidla typu: „nikdy nemanipuluj `.env`“, „nepushuj bez testů“, „nevolej externí URL mimo allowlist“.

2. **Secrets scanning před commitem**
   - Git hook/CI krok se skenem tokenů.

3. **Command denylist + allowlist**
   - Pro bash nástroj explicitní blokace nebezpečných příkazů a argumentů.

4. **Rate limiting per user/channel**
   - Ochrana proti spamu i nákladovým špičkám.

---

## 5) UX v Telegram/WhatsApp

1. **Interaktivní menu pro top akce**
   - Tlačítka/quick replies pro `status`, `plan`, `execute`, `approve`, `cancel`.

2. **Streaming průběhu dlouhých úkolů**
   - Průběžné mezikroky místo jedné finální zprávy.

3. **Error messages s doporučením opravy**
   - Každá chyba: co se stalo + „co udělat teď“.

4. **Šablony promptů**
   - Předdefinované “macro” prompty pro běžné use-cases (debug, refactor, deploy-check).

---

## 6) Návrh roadmapy

### Milestone A (1–2 týdny)
- Confirm-before-execute
- Rozšířený status
- Health/readiness endpoint
- Strukturované logy

### Milestone B (2–4 týdny)
- Queue + retry policy
- Kontrakty mezi sub-agenty (JSON schema)
- Per-user sandbox profily

### Milestone C (4–8 týdnů)
- Skill registry
- Circuit breakers pro providery
- Pokročilá paměť (relevance + expirace)

---

## 7) KPI pro měření dopadu

- **Reliability:** úspěšnost execute runů (%), MTTR po chybě.
- **Safety:** počet blokovaných rizikových akcí, incidenty = 0.
- **UX:** čas do první smysluplné odpovědi, completion rate úkolů.
- **Cost:** průměrné tokeny na úkol, náklad na 100 úkolů.

---

## 8) Doporučení implementace (prakticky)

- Začít od **guardrails + observability** (nejvyšší poměr přínos/riziko).
- Teprve pak škálovat “smart” funkce jako advanced memory a plugin registry.
- Každou změnu nasazovat přes malé inkrementy + rollback plán.
