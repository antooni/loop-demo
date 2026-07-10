# Loop Engineering Demo 🔁

**PL** · Hierarchia agentów AI, która sama planuje, buduje i weryfikuje aplikację — Ty tylko mówisz *co*, a nie *jak*.
**EN** · A hierarchy of AI agents that plans, builds and verifies an app on its own — you state *what*, never *how*.

![Dashboard](docs/dashboard.svg)

```
Człowiek / Human
   └──▶ 🧠 ORCHESTRATOR   (Opus, sesja interaktywna / interactive session)
            │  zbiera wymagania, szacuje czas i koszt / gathers requirements, estimates time & cost
            └──▶ 📋 TEAM LEAD   (Sonnet, headless, w tle / background)
                     │  dzieli pracę na małe zadania / splits work into small tasks
                     ├──▶ 🔨 WORKER 1  (Haiku, równolegle / parallel)
                     ├──▶ 🔨 WORKER 2  (Haiku, równolegle / parallel)
                     └──▶ 🔨 WORKER N  — pętla aż zadanie przejdzie weryfikację
                                         loops until its verify command passes
```

Mocne modele podejmują decyzje, tanie modele wykonują robotę. Wszystko na Twojej
subskrypcji Claude — zero kluczy API, zero własnego kodu LLM.
Strong models decide, cheap models execute. Runs on your Claude subscription —
no API keys, no custom LLM code.

---

## 🇵🇱 Polski

### Wymagania

- [Claude Code](https://code.claude.com) zainstalowany i zalogowany (subskrypcja Pro/Max)
- Node.js 18+
- Przeglądarka na http://localhost:3333

### Szybki start

```bash
git clone <to-repo> && cd loop-demo
claude          # uruchom Claude Code w katalogu repo
```

W sesji napisz po prostu **`start`**. Orchestrator:

1. odpali live dashboard na **http://localhost:3333** — otwórz go w przeglądarce,
2. zada Ci kilka pytań o to, co zbudować (celuj w *mikro apkę społeczną* — posty,
   lajki, feed; demo pokazuje mechanikę, nie buduje Facebooka),
3. **poda estymatę czasu, tokenów i kosztu** i poczeka na Twoją zgodę,
4. po akceptacji odpali w tle Team Leada (Sonnet), który rozdzieli pracę na
   równoległych Workerów (Haiku) — a Ty patrzysz na dashboard,
5. na końcu zweryfikuje wynik i porówna rzeczywisty koszt z estymatą.

Zbudowana apka ląduje w `workspace/` — uruchomisz ją zwykle przez
`node workspace/server.js`.

### Chcesz tylko zobaczyć dashboard? Tryb demo (0 tokenów)

```bash
node dashboard/server.js     # terminal 1
node scripts/demo.js         # terminal 2 (DEMO_SPEED=3 → szybciej)
```

Odtwarza nagraną misję: wywiad, planowanie, 3 równoległe workery, jedna wpadka
z retry, integracja i raport.

### Ile to kosztuje?

Misja typu "mikro apka społeczna" (4–6 zadań): **~10–20 minut** i **~$0.50–1.50**
z subskrypcji. Orchestrator ma obowiązek pokazać estymatę **przed** startem i
zbijać zakres, jeśli robi się drogo. Cennik: Opus $5/$25, Sonnet $3/$15,
Haiku $1/$5 za 1M tokenów (wejście/wyjście).

### Jak to działa pod maską

| Element | Rola |
|---|---|
| `CLAUDE.md` | prompt Orchestratora (wywiad, estymaty, spawn, raport) |
| `agents/team-lead.md` | prompt Team Leada — dekompozycja, nadzór, retry, raport |
| `agents/worker.md` | prompt Workera — jedno zadanie, pętla aż verify przejdzie |
| `scripts/spawn-*.sh` | odpalają `claude -p --model sonnet/haiku` w tle |
| `scripts/event-pipe.js` | normalizuje `--output-format stream-json` do `.loop/events.jsonl` |
| `scripts/hook-event.js` | hook logujący sesję Orchestratora do tego samego strumienia |
| `.loop/` | szyna komunikacji: `mission.md` → `tasks/*.md` → `status/*.json` → `report.md` |
| `dashboard/` | serwer SSE + UI "mission control" (czysty Node, zero zależności) |

Agenci nie rozmawiają ze sobą bezpośrednio — komunikują się przez pliki. Team Lead
definiuje w każdym zadaniu *kontrakt interfejsu* (trasy, kształty JSON, porty),
dzięki czemu równolegli Workerzy nie muszą się koordynować.

### Troubleshooting

- **Worker utknął na uprawnieniach** — headless agenci działają z
  `--permission-mode acceptEdits` + allowlistą z `.claude/settings.json`. Jeśli
  misja wymaga komend spoza listy: `export LOOP_PERMISSION_MODE=bypassPermissions`
  przed startem (świadomie — wyłącza pytania o zgodę) albo dopisz regułę do settings.
- **Dashboard pusty** — sprawdź, czy `node dashboard/server.js` działa i czy
  istnieje `.loop/events.jsonl`.
- **Team Lead umarł** — `tail .loop/logs/team-lead.err`; Orchestrator zaproponuje respawn.
- **Nowa misja** — zarchiwizuj stan: `mv .loop .loop.prev-$(date +%s)` (skill `/start` sam o to zapyta).

---

## 🇬🇧 English

### Requirements

- [Claude Code](https://code.claude.com) installed and logged in (Pro/Max subscription)
- Node.js 18+
- A browser pointed at http://localhost:3333

### Quick start

```bash
git clone <this-repo> && cd loop-demo
claude          # launch Claude Code inside the repo
```

Then just type **`start`**. The Orchestrator will:

1. boot the live dashboard at **http://localhost:3333** — open it in a browser,
2. interview you briefly about what to build (aim for a *micro social app* —
   posts, likes, a feed; this demo shows the mechanics, it doesn't build Facebook),
3. present a **time / tokens / cost estimate** and wait for your approval,
4. spawn a background Team Lead (Sonnet) that fans the work out to parallel
   Workers (Haiku) — while you watch the dashboard,
5. verify the result and compare actual cost against the estimate.

The built app lands in `workspace/` — typically run with `node workspace/server.js`.

### Just want to see the dashboard? Demo mode (0 tokens)

```bash
node dashboard/server.js     # terminal 1
node scripts/demo.js         # terminal 2 (DEMO_SPEED=3 → faster)
```

Replays a recorded mission: interview, planning, 3 parallel workers, one failure
with a retry, integration and the final report.

### What does it cost?

A "micro social app" mission (4–6 tasks): **~10–20 minutes** and **~$0.50–1.50**
of subscription usage. The Orchestrator must show an estimate **before** starting
and push the scope down when it gets expensive. Pricing: Opus $5/$25,
Sonnet $3/$15, Haiku $1/$5 per 1M tokens (input/output).

### How it works under the hood

| Piece | Role |
|---|---|
| `CLAUDE.md` | Orchestrator prompt (interview, estimates, spawning, final report) |
| `agents/team-lead.md` | Team Lead prompt — decomposition, supervision, retries, report |
| `agents/worker.md` | Worker prompt — one task, loop until the verify command passes |
| `scripts/spawn-*.sh` | launch `claude -p --model sonnet/haiku` in the background |
| `scripts/event-pipe.js` | normalizes `--output-format stream-json` into `.loop/events.jsonl` |
| `scripts/hook-event.js` | Claude Code hook logging the Orchestrator session into the same stream |
| `.loop/` | the communication bus: `mission.md` → `tasks/*.md` → `status/*.json` → `report.md` |
| `dashboard/` | SSE server + "mission control" UI (plain Node, zero dependencies) |

Agents never talk to each other directly — they communicate through files. The
Team Lead writes an *interface contract* into every task (routes, JSON shapes,
ports), so parallel Workers never need to coordinate.

### Troubleshooting

- **A worker stalls on permissions** — headless agents run with
  `--permission-mode acceptEdits` plus the allowlist in `.claude/settings.json`.
  If your mission needs commands outside the list: `export LOOP_PERMISSION_MODE=bypassPermissions`
  before starting (a deliberate choice — it disables approval prompts), or add a rule to settings.
- **Dashboard is empty** — make sure `node dashboard/server.js` is running and
  `.loop/events.jsonl` exists.
- **Team Lead died** — `tail .loop/logs/team-lead.err`; the Orchestrator will offer a respawn.
- **Fresh mission** — archive state with `mv .loop .loop.prev-$(date +%s)` (the `/start` skill offers this).
