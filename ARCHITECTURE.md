# Architecture de Dromadaire

Ce document décrit le code de Dromadaire : ses composants, la façon dont ils communiquent, et l'intégration de la bibliothèque `lamazero.dll` (moteur CPU). Il s'adresse aux développeurs et aux IA qui travaillent sur le dépôt.

Pour l'utilisation et la présentation, voir [README.md](README.md). Pour les tests, voir [docs/TEST_PLAN.md](docs/TEST_PLAN.md).

---

## 1. Vue d'ensemble

```
 ┌──────────────────────────── Dromadaire.exe (app/) ─────────────────────────────┐
 │                                                                                │
 │  Interface React (app/ui/app)  ──HTTP /api/v1/*──►  Serveur de l'application   │
 │                                                      (app/ui, app/store)       │
 │                                                             │                  │
 │                                              lance et surveille un processus   │
 │                                              (app/server, boucle de redémarrage)│
 │                                                             ▼                  │
 │                                             ollama.exe serve  (server/, llm/)  │
 │                                              API Ollama  /api/chat, /api/pull…  │
 │                                                  │                    │         │
 │                          moteur GPU (llama/llm)  ◄┘                    └─► moteur CPU lamazero
 │                          backends CUDA lib\ollama\                        lib\lamazero\*.dll
 └────────────────────────────────────────────────────────────────────────────────┘
```

Deux processus :

1. **L'application** (`app/cmd/app`, binaire `dromadaire.exe`) : fenêtre, barre système, serveur HTTP de l'interface (`app/ui`), base de données (`app/store`), et supervision du moteur.
2. **Le moteur** (`ollama.exe serve`, code dans `server/`, `llm/`, `ml/`, `discover/`) : l'API Ollama compatible, le chargement des modèles, l'inférence GPU et CPU.

L'interface ne parle qu'à l'application (`/api/v1/*`). L'application transmet ensuite les requêtes d'inférence au moteur (API Ollama). Les réglages sont stockés par l'application et transmis au moteur par **variables d'environnement** au moment où il démarre.

---

## 2. Arborescence utile

| Dossier | Rôle |
|---|---|
| `app/cmd/app/` | Point d'entrée de l'application (`main`), fenêtre, icône, mise à jour. |
| `app/server/` | Supervision du moteur : construit l'environnement, lance `ollama serve`, redémarre sur demande. |
| `app/ui/` | Serveur HTTP de l'application : endpoints `/api/v1/*` (réglages, redémarrage, modèles…). |
| `app/store/` | Base SQLite des réglages, chats, messages. Schéma versionné (migrations `migrateVxToVy`). |
| `app/ui/app/` | Interface web : React 19, TanStack Router et Query, Tailwind, Vite. |
| `server/` | Serveur de l'API Ollama : routes `/api/chat`, `/api/generate`, `/api/pull`… Contient aussi l'adaptateur **lamazero**. |
| `llm/`, `llama/`, `runner/` | Gestion des runners d'inférence (processus de génération, chargement, mémoire). |
| `ml/`, `discover/` | Détection du matériel (GPU, VRAM) et choix du backend. |
| `lamazero/` | Liaison Go vers `lamazero.dll` (chargement dynamique, sessions, options). |
| `api/`, `types/` | Types partagés de l'API (`api.Options`, `api.ChatRequest`…). |
| `dist/` | Sortie de build, **non suivie par Git**. Contient `ollama.exe`, `lib\ollama\` (CUDA, CPU) et `lib\lamazero\`. |
| `docs/` | Documentation, dont le plan de tests. |
| `scripts/` | Scripts de build (`build_windows.ps1`, `build_linux.sh`…). |

Les fichiers `.gitignore` de `app/` et de la racine excluent `dist/`, `node_modules/`, `test-results/` et les dossiers de build.

---

## 3. Le serveur de l'application (`app/`)

### 3.1 Démarrage et supervision du moteur

`app/cmd/app/app.go` (`main`) démarre l'application. Le serveur de supervision `app/server/server.go` :

- construit l'environnement du processus moteur à partir des réglages (`cmd()`), notamment :
  - `OLLAMA_NUM_BATCH`, `OLLAMA_KV_CACHE_TYPE` (GPU) ;
  - `DROMADAIRE_LAMAZERO_ENGINE` et `DROMADAIRE_LAMAZERO_KV` (CPU lamazero) ;
- lance `ollama.exe serve` et attend sa fin ;
- sur un signal (`restartCh`), arrête le processus et le relance avec l'environnement **courant** ;
- mémorise les réglages lamazero utilisés au dernier lancement (`setAppliedLamazero`), pour savoir si un redémarrage est nécessaire (`LamazeroRestartPending`).

### 3.2 API de l'interface (`app/ui/ui.go`)

Les routes sont enregistrées dans `mux.Handle("METHOD /api/v1/…")`. Principales familles :

| Route | Rôle |
|---|---|
| `GET/POST /api/v1/settings` | Lecture et écriture des réglages (stockés dans SQLite). |
| `POST /api/v1/restart-server` | Demande le redémarrage du moteur (signal sur `restartCh`). |
| `GET /api/v1/restart-status` | Indique si un réglage (moteur ou cache KV lamazero) attend un redémarrage : `{ "needed": bool }`. |
| `GET /api/v1/system-resources` | RAM totale et disponible (utilisé par le téléchargeur). |
| `GET /api/v1/hardware-info` | Matériel détecté (CPU, GPU). |

### 3.3 Base de données (`app/store/`)

- SQLite, schéma versionné : `currentSchemaVersion` (actuellement **32**).
- Chaque nouvelle colonne de réglage = une migration `migrateVxToVy` qui ajoute la colonne (`ALTER TABLE … ADD COLUMN`) et une entrée dans `CREATE TABLE`.
- Réglages lamazero : `lamazero_engine` (`auto` | `official` | `turbo`) et `lamazero_kv_cache` (`f16` | `turbo3` | `turbo4`), migration v32.
- Le type Go `store.Settings` est exposé tel quel par l'API et reflété côté TypeScript dans `app/ui/app/codegen/gotypes.gen.ts` et `app/ui/app/src/api.ts`.

---

## 4. L'interface (`app/ui/app/`)

### 4.1 Stack

React 19, TanStack Router (routes typées), TanStack Query (cache serveur), Tailwind CSS, Vite. Tests : Vitest (unitaires) et Playwright (E2E, API simulée).

### 4.2 Organisation

| Dossier | Contenu |
|---|---|
| `src/routes/` | Pages : `index` (chat), `c.$chatId` (conversation), `models` (téléchargeur), `settings`, `knowledge`, `agents`, `workflows.$workflowId`, `about`. `__root.tsx` est le cadre commun. |
| `src/components/` | Composants : `Settings.tsx`, `ModelDiscovery.tsx` (téléchargeur), `ModelBar.tsx`, `RestartBanner.tsx` (bannière globale), etc. |
| `src/hooks/` | Hooks métier (`useSettings`, `useModels`, `useChats`, `useSystemResources`…). |
| `src/lib/` | Logique pure, testable sans React : `modelPull.ts`, `modelSearch.ts`, `config.ts` (adresse de l'API), `renderers.ts`, `export.ts`… |
| `src/api.ts` | Appels HTTP vers `/api/v1/*` et types de réponse. |
| `codegen/gotypes.gen.ts` | Types générés depuis les structures Go (à garder synchrone avec `store.Settings`). |

### 4.3 Réglages et redémarrage

1. L'utilisateur change un réglage (`Settings.tsx`, sélecteurs de performance).
2. `POST /api/v1/settings` enregistre la valeur en base.
3. `RestartBanner` (monté dans `__root.tsx`, donc visible sur **toutes** les pages) interroge `GET /api/v1/restart-status` toutes les 5 secondes.
4. Si `needed` est vrai, la bannière propose « Redémarrer maintenant ». Le clic appelle `restart-server`, puis la bannière attend que le serveur réponde et invalide le cache.

### 4.4 Téléchargement de modèles

Le téléchargeur est `components/ModelDiscovery.tsx` (route `/models`). Il s'appuie sur deux modules purs :

- **`lib/modelSearch.ts`** : recherche sur HuggingFace (`/api/models?search=…&filter=gguf`).
  - `findAbliteratedModels(query)` interroge plusieurs formulations (`<requête> abliterated`, `<requête> uncensored`), fusionne, dédoublonne, et ne garde que les dépôts dont le nom ou les tags contiennent `abliterated`, `abliteration`, `uncensored` ou `heretic`.
  - `rankAbliteratedFirst(items)` place les modèles sans censure en tête, puis trie par téléchargements.
- **`lib/modelPull.ts`** : téléchargement via `POST /api/pull` (flux NDJSON).
  - Une ligne `{"error": …}` dans le flux (HTTP 200) est traitée comme une erreur.
  - Un flux qui se ferme sans `{"status":"success"}` est une interruption, relancée jusqu'à deux fois. Ollama reprend les fichiers déjà reçus.
  - Les erreurs connues sont traduites (`friendlyPullError` : dépôt introuvable, accès refusé, disque plein).
  - Annulation par `AbortController` (un par modèle).

Les modèles HuggingFace sont demandés avec le préfixe `hf.co/` et le quantificateur détecté dans le nom du fichier (`hf.co/auteur/dépôt:Q4_K_M`), via `pullNameFor`.

### 4.5 Préréglages du téléchargeur

Trois préréglages (`preset-all`, `preset-abliterated`, `preset-compatible`) :
- **Tous** : résultats classés, sans censure en premier ;
- **Abliterated** : `findAbliteratedModels` uniquement ;
- **Compatibles avec mon PC** : retire les modèles dont la taille estimée dépasse la RAM disponible (`getHardwareCompat`).

---

## 5. Les moteurs d'inférence

Deux chemins coexistent. Ils sont choisis **par le nom du modèle** :

| Modèle | Moteur | Où |
|---|---|---|
| `qwen2.5:7b`, `hf.co/…`, etc. | **GPU / CPU Ollama** (llama.cpp intégré à `ollama.exe`, backends CUDA dans `lib\ollama\`) | `server/routes.go` → `scheduleRunner` → runner `llm/` |
| `lamazero/<nom>` | **CPU lamazero** (`lamazero.dll`, chargée à l'exécution) | `server/lamazero_engine.go` |

### 5.1 Moteur GPU (inchangé)

`discover/` détecte les GPU et choisit la bibliothèque (`cuda_v13`, `cuda_v12`, Vulkan, CPU) dans `lib\ollama\`. Les backends CUDA sont embarqués dans l'installeur (`lib\ollama\*`). Ce chemin n'a pas été modifié par l'intégration lamazero.

### 5.2 Moteur CPU lamazero

Un modèle est servi par lamazero quand son **namespace** est `lamazero` (ex. `ollama cp qwen2.5:0.5b lamazero/qwen2.5:0.5b`). La fonction `isLamazeroName` le détecte. Dans `ChatHandler`, ces modèles :

1. ne passent pas par le planificateur GPU (`scheduleRunner`) ;
2. utilisent `lamazeroRunnerFor`, qui renvoie un `lamazeroRunner` implémentant `llm.LlamaServer` ;
3. ne prennent pas le chemin « natif » (`handleNativeChat`) : le prompt est rendu par le moteur de templates standard, comme pour les autres modèles.

Le `lamazeroRunner` ne fait réellement que `Completion` (génération en streaming) et `ContextLength`. Les autres méthodes de l'interface (`Chat`, `Embedding`, `Tokenize`…) renvoient `errLamazeroUnsupported`.

#### Sélection du moteur et du cache

`applyKVCacheSetting` lit deux variables d'environnement, posées par l'application à partir des réglages :

| Variable | Valeurs | Effet |
|---|---|---|
| `DROMADAIRE_LAMAZERO_ENGINE` | `auto` (défaut), `official`, `turbo` | `auto` choisit TurboQuant si un cache compressé est demandé, sinon officiel. |
| `DROMADAIRE_LAMAZERO_KV` | `f16` (défaut), `turbo3`, `turbo4` | Type du cache KV. `official` ne sait pas utiliser `turbo*` : retombe sur F16. |

#### Cycle de vie du modèle

- Une seule session est chargée à la fois (`lamazeroState`). Les requêtes sont sérialisées par un mutex.
- Une session est rechargée si le chemin du modèle, le moteur ou les paramètres changent.
- Déchargement automatique après **5 minutes** sans requête (`lamazeroIdleUnload`, minuterie réarmée à chaque génération).
- Les paramètres de sampling viennent des options Dromadaire (`temperature`, `top_k`, `top_p`, `min_p`, `repeat_penalty`, `seed`…). `format: "json"` active une grammaire GBNF. `stop` est géré côté Go avec un tampon de retenue, pour ne pas émettre une séquence d'arrêt partielle.

---

## 6. Intégration de `lamazero.dll`

### 6.1 Ce qu'est la DLL

`lamazero` est une bibliothèque C publiée séparément (dépôt `ayinedjimi/lamazero`). Elle absorbe llama.cpp et ggml **en statique** : un seul fichier, qui dépend uniquement du runtime Visual C++ (`VCRUNTIME140`, `MSVCP140`, `VCOMP140`).

Son API est définie dans `include/lamazero.h`. Les fonctions utilisées par Dromadaire :

| Fonction | Rôle |
|---|---|
| `lamazero_version` | Chaîne de version (ex. `lamazero 2.0.0 (llama.cpp b12403, CPU, AVX2)`). |
| `lamazero_load_ex(path, &params, &status)` | Charge un GGUF avec `lamazero_load_params` (contexte, threads, batch, flash attention, types KV, mmap, mlock). |
| `lamazero_set_sampling(session, &sampling)` | Remplace le sampler (`lamazero_sampling_params`, grammaire incluse). |
| `lamazero_chat_stream_ex(session, prompt, max, timeout, cb, ud, &n, &reused, &ms)` | Génère en streaming. Réutilise le préfixe déjà présent dans le cache KV. |
| `lamazero_clear_cache`, `lamazero_n_ctx`, `lamazero_quick_free` | Gestion de la session. |

Les codes d'erreur sont négatifs (`LAMAZERO_ERR_*`, voir `lamazero/lamazero_windows.go`).

### 6.2 Deux builds

| Fichier | Source llama.cpp | Usage |
|---|---|---|
| `lamazero.dll` | ggml-org, tag `b12403` | Moteur **officiel** : architectures récentes (ex. `lfm3`). |
| `lamazero-turbo.dll` | Fork `AtomicBot-ai/atomic-llama-cpp-turboquant` (MIT) | Cache KV compressé `turbo3` / `turbo4` (types ggml 44 et 47). Ne connaît pas `lfm3`. |

Les deux DLL exposent la même API. Elles sont chargées séparément par `syscall.LoadDLL` : deux bibliothèques ne peuvent pas être fusionnées, car chacune embarque sa propre copie de llama.cpp.

### 6.3 Chargement dans le code Go (`lamazero/lamazero_windows.go`)

- `getEngine(name)` charge une DLL **une seule fois** (`sync.Once` par moteur) et résout les symboles par `FindProc`. Une DLL absente ou incomplète produit `ErrUnavailable` sans faire planter l'application.
- Chemins de recherche, dans l'ordre :
  - variable `LAMAZERO_DLL` (moteur officiel, utile aux tests) ou `LAMAZERO_DLL_TURBO` ;
  - sinon `<dossier de l'exécutable>\lib\lamazero\<nom>.dll`.
- Les callbacks C → Go passent par une table `handlers` indexée par un entier (`user_data`), car `syscall.NewCallback` ne capture pas de closure.
- Les caractères UTF-8 coupés entre deux tokens sont retenus jusqu'au caractère suivant (`completeUTF8Prefix`).
- Aucun CGO : le binding n'a besoin que d'un compilateur Go standard.

Sur les autres systèmes, `lamazero/lamazero_other.go` expose la même API et renvoie `ErrUnavailable`.

### 6.4 Où vivent les fichiers

```
dist\windows-amd64\lib\lamazero\lamazero.dll          ← moteur officiel
dist\windows-amd64\lib\lamazero\lamazero-turbo.dll    ← moteur TurboQuant
```

- `dist\` est généré et non suivi par Git.
- L'installeur `app/dromadaire.iss` embarque `..\dist\windows-amd64\lib\lamazero\*.dll` dans `{app}\lib\lamazero\`, et supprime ce dossier à la désinstallation.

### 6.5 Construire les DLL

**Build officiel** (Visual Studio 2022 Build Tools, C++) :

```powershell
cd D:\lamazero
.\scripts\build.ps1 -LlamaTag b12403 -Jobs 8
# résultat : dist\lamazero.dll
```

**Build TurboQuant** (fork local, sans téléchargement) :

```powershell
cmake -S D:\lamazero -B D:\lamazero\build-turbo -G "Visual Studio 17 2022" -A x64 `
  "-DFETCHCONTENT_SOURCE_DIR_LLAMA_CPP=D:/atomic-llama-cpp-turboquant" `
  "-DLAMAZERO_LLAMA_LABEL=turboquant-1937695"
cmake --build D:\lamazero\build-turbo --config Release --target lamazero -j 8
# résultat : D:\lamazero\build-turbo\bin\Release\lamazero.dll
```

Puis copier les DLL dans `dist\windows-amd64\lib\lamazero\` (le nom de la copie TurboQuant doit être `lamazero-turbo.dll`).

**Limite connue** : `scripts/build_windows.ps1` ne copie pas encore les DLL lamazero dans `dist`. Cette étape est manuelle ; elle doit être ajoutée au script de build.

### 6.6 Outils de conversion

Le serveur valide les GGUF importés avec `llama-quantize`, cherché dans `lib\ollama\`. Ce binaire doit connaître l'architecture du modèle : pour `lfm3`, il faut une version upstream récente (le binaire du fork TurboQuant ne suffit pas).

---

## 7. Tests

| Niveau | Où | Lancement |
|---|---|---|
| Go, logique (sélection moteur, redémarrage, arrêt/UTF-8) | `server/lamazero_*_test.go`, `app/server/lamazero_restart_test.go` | `go test ./server/ ./app/server/` |
| Go, moteur réel | `lamazero/lamazero_test.go`, `lamazero/turbo_kv_test.go` | variables `LAMAZERO_DLL`, `LAMAZERO_DLL_TURBO`, `LAMAZERO_MODEL` ; sinon ignorés |
| Vitest, lib pure | `app/ui/app/src/lib/modelPull.test.ts`, `modelSearch.test.ts` | `npx vitest run src/lib/modelPull.test.ts` |
| Playwright, interface (API simulée) | `app/ui/app/e2e/model-discovery.spec.ts`, `restart-banner.spec.ts`, `settings-performance.spec.ts` | `npx playwright test e2e/<fichier>` |

Le plan complet, avec les identifiants de test (`data-testid`) et la couverture par écran, est dans [docs/TEST_PLAN.md](docs/TEST_PLAN.md).

---

## 8. Build et livraison

- `scripts/build_windows.ps1` : compile `ollama.exe` (moteur), `dromadaire.exe` (application), et prépare `dist\windows-amd64\`. Il gère les backends CUDA, ROCm et Vulkan.
- `app/dromadaire.iss` : script Inno Setup. Il produit `DromadaireSetup.exe`, qui embarque `ollama.exe`, `lib\ollama\*`, `lib\lamazero\*.dll` et le redistribuable VC++ si nécessaire.
- Les DLL lamazero sont à reconstruire et à copier dans `dist` avant de lancer l'installeur (voir 6.5).

---

## 9. Limites connues

- **Une seule session lamazero** à la fois : charger un autre modèle `lamazero/` décharge le précédent.
- **Pas d'images, pas d'appels d'outils natifs, pas de thinking natif** sur le moteur CPU.
- **Réglage du moteur par variable d'environnement** : le changement n'est appliqué qu'après redémarrage du moteur. La bannière de redémarrage ne surveille que les réglages lamazero, pas encore les réglages GPU (`Cache KV`, taille de batch).
- **Le fork TurboQuant ne connaît pas les architectures récentes** (ex. `lfm3`). Le choix du moteur doit tenir compte de l'architecture du modèle.
- **Compatibilité du backend CUDA** : les backends `cuda_v13` / `cuda_v12` viennent d'une autre version d'Ollama que `ggml.dll` de Dromadaire. Non vérifié sur GPU.
- **Build non automatisé** pour les DLL lamazero (voir 6.5).
