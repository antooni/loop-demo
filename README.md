# Loop Engineering Demo

Minimalna hierarchia coding-agentów działająca przez API. OpenCode dostarcza narzędzia,
uprawnienia i sesje; modele wybierasz niezależnie dla każdej roli, np. przez OpenRouter.

![Dashboard](docs/dashboard.svg)

```text
Human -> Orchestrator
              -> deterministic Node controller
                    -> Team Lead: plan
                    -> Workers: parallel implementation
                    -> Team Lead: verification/report
```

Controller, nie model, odpowiada za czekanie, retry, timeouty, budżet i statusy. Dzięki
temu Team Lead nie spala tokenów na `sleep`, polling ani ręczne pisanie JSON-a.

## Wymagania

- Node.js 18+
- [OpenCode](https://opencode.ai) 1.17+
- klucz API wybranego providera; przykłady poniżej używają OpenRoutera

## Konfiguracja

```bash
opencode auth login
opencode models openrouter
```

Wybierz OpenRouter podczas logowania, a następnie ustaw pełne identyfikatory
`provider/model` w `loop.config.json`:

```json
{
  "models": {
    "orchestrator": "openrouter/<model-id>",
    "teamLead": "openrouter/<model-id>",
    "worker": "openrouter/<model-id>"
  },
  "maxCostUsd": 3,
  "agentTimeoutMs": 600000,
  "workerRetries": 1
}
```

Wartości można nadpisać bez edycji pliku:

```bash
export LOOP_ORCHESTRATOR_MODEL=openrouter/<model-id>
export LOOP_TEAM_LEAD_MODEL=openrouter/<model-id>
export LOOP_WORKER_MODEL=openrouter/<model-id>
```

## Start

```bash
opencode --agent orchestrator --model openrouter/<orchestrator-model>
```

W sesji napisz `start`. Orchestrator uruchomi dashboard, zbierze wymagania, pokaże
limit kosztu i dopiero po zatwierdzeniu uruchomi `node scripts/start-mission.js`.

Dashboard: `http://127.0.0.1:3333`

## Statusy

- Orchestrator: `interviewing`, `awaiting_approval`, `launching`, `monitoring`,
  `verifying`, `reporting`, `done`, `failed`.
- Team Lead: `starting`, `planning`, `dispatching`, `waiting_workers`,
  `reviewing_results`, `integrating`, `verifying`, `reporting`, `done`, `failed`.
- Worker: `queued`, `running`, `done`, `failed`.

Workerzy nie generują opisowych statusów. Dashboard pokazuje ich zwykłe tool events.

## Testy I Demo

```bash
node --test
node dashboard/server.js
DEMO_SPEED=5 node scripts/demo.js
```

Testy i `demo.js` nie wykonują płatnych wywołań API. Testują między innymi crash,
timeout, retry, atomowe statusy i reconnect SSE bez podwajania kosztu.

## Pliki

| Element | Rola |
|---|---|
| `scripts/controller.js` | deterministyczne fazy, retry, timeout i budżet |
| `scripts/agent-runner.js` | bezpieczne `opencode run --format json` bez shella |
| `scripts/status.js` | walidowane, atomowe statusy |
| `agents/*.md` | prompty Team Leada i Workera |
| `opencode.json` | narzędzia i permissions ról |
| `loop.config.json` | modele i limity runtime |
| `.loop/` | mission, tasks, statuses, events i report |
| `dashboard/` | lokalny serwer SSE i UI |

## English

This is a minimal API-backed coding-agent hierarchy. OpenCode provides tools,
permissions and sessions; OpenRouter is the initial provider, and every role accepts a
full configurable `provider/model` ID.

Run `opencode auth login`, configure `loop.config.json`, then launch:

```bash
opencode --agent orchestrator --model openrouter/<orchestrator-model>
```

Type `start`. The Orchestrator interviews you and requires explicit budget approval.
The deterministic controller then plans with a Team Lead session, runs Workers in
parallel, waits without model turns, and resumes the Team Lead for verification.

Use `node --test` for the credential-free regression suite, or run the zero-cost UI
replay with `node dashboard/server.js` and `DEMO_SPEED=5 node scripts/demo.js`.
