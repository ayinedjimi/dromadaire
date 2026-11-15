# Plan de tests — Dromadaire

Ce document permet à une IA (ou à un humain) de tester automatiquement l'application :
la GUI, l'API et les moteurs d'inférence (CPU lamazero et GPU Ollama).

## 1. Niveaux de test

| Niveau | Outil | Périmètre | Backend requis | GPU requis |
|---|---|---|---|---|
| Unitaires Go | `go test` | API, parseurs, adaptateur lamazero, arrêt/UTF-8 | non | non |
| Moteur CPU | `go test ./lamazero/` | DLL lamazero réelle (chargement, génération, cache de préfixe) | DLL + modèle GGUF | non |
| Unitaires UI | Vitest | composants et hooks isolés | non | non |
| E2E GUI (mockée) | Playwright | toute la GUI, API simulée (`e2e/fixtures.ts`) | non (Vite seul) | non |
| E2E GUI (réelle) | Playwright | GUI + `dromadaire.exe` en marche | oui | optionnel |

Le niveau « E2E GUI (mockée) » est celui à lancer en priorité : il ne demande ni GPU, ni réseau, ni modèle.

## 2. Pré-requis

- Node.js 20+ et `npm ci` dans `app/ui/app` ; Chromium Playwright (`npx playwright install chromium`).
- Go 1.26+ pour les tests Go.
- Pour les tests moteur : `lamazero.dll` (dans `dist\windows-amd64\lib\lamazero\`) et un petit GGUF (ex. Qwen2.5 0,5B Q4_K_M).

Variables d'environnement pour les tests moteur :

```
LAMAZERO_DLL=D:\dromadaire-v8\dist\windows-amd64\lib\lamazero\lamazero.dll
LAMAZERO_MODEL=D:\models-test\qwen2.5-0.5b-instruct-q4_k_m.gguf
```

Sans ces variables, les tests moteur sont ignorés (`t.Skip`), jamais en échec.

## 3. Commandes

```powershell
# Go : unitaires + moteur (si variables définies)
cd D:\dromadaire-v8
go test ./server/ -run 'TestStopHoldback|TestLamazero' -count=1
go test ./lamazero/ -count=1 -v

# E2E GUI mockée : toute la suite
cd D:\dromadaire-v8\app\ui\app
npx playwright test

# E2E d'un seul écran (ex. téléchargeur de modèles)
npx playwright test e2e/model-discovery.spec.ts

# Rapport HTML après exécution
npx playwright show-report
```

Résultats : `test-results/` (captures d'écran et traces des échecs).

## 4. Conventions pour les sélecteurs (contrat avec les tests)

Les tests s'appuient sur des `data-testid` stables. Ne pas les renommer sans mettre à jour les specs.

| Élément | Sélecteur | Où |
|---|---|---|
| Bascule mode connecté (HuggingFace) | `online-toggle` (attribut `aria-pressed`) | `ModelDiscovery.tsx` |
| Préréglages de recherche | `preset-all`, `preset-abliterated`, `preset-compatible` | `ModelDiscovery.tsx` |
| Champ de recherche du téléchargeur | `model-search` | `ModelDiscovery.tsx` |
| Carte d'un modèle | `model-card` + `data-model`, `data-compat`, `data-abliterated` | `ModelDiscovery.tsx` |

Règle : tout nouvel élément interactif reçoit un `data-testid` de la forme `<zone>-<action>`.

## 5. Plan de tests GUI (fonctions à couvrir)

Statut : **couvert** = spec existante qui passe ; **à écrire** = non couvert.

### 5.1 Téléchargeur de modèles (`/models`)
| Fonction | Spec | Statut |
|---|---|---|
| Affichage des modèles installés et recommandés | `model-discovery.spec.ts` (indirect) | à compléter |
| Activation du mode connecté | `model-discovery.spec.ts` | couvert |
| Préréglage Abliterated : requête HF avec le mot-clé | `model-discovery.spec.ts` | couvert |
| Badge abliterated sur les cartes | `model-discovery.spec.ts` | couvert |
| Préréglage Compatibles : retrait des modèles trop gros | `model-discovery.spec.ts` | couvert |
| Recherche libre combinée à un préréglage | `model-discovery.spec.ts` | couvert |
| Téléchargement d'un modèle (progression, erreur, annulation) | — | à écrire |
| Choix du moteur GPU / CPU selon le matériel détecté | — | à écrire (après intégration GPU) |

### 5.2 Chat
Couvert par `chat.spec.ts`, `streaming*.spec.ts`, `message-actions.spec.ts`, `chatform-controls.spec.ts`.
À écrire : sélection d'un modèle `lamazero/` dans le sélecteur, réponse en mode CPU, arrêt par séquence d'arrêt.

### 5.3 Paramètres, thèmes, navigation, accessibilité
Couvert par `settings*.spec.ts`, `themes.spec.ts`, `navigation.spec.ts`, `keyboard-shortcuts-deep.spec.ts`, `responsive.spec.ts`, `mobile-ux.spec.ts`.

### 5.4 Autres écrans
Couvert par `knowledge-deep.spec.ts`, `workflow-*.spec.ts`, `password-flow.spec.ts`, `encryption.spec.ts`, `incognito.spec.ts`, `airplane.spec.ts`.

## 6. Données de test

- Le backend est simulé dans `e2e/fixtures.ts` (paramètres, chats, modèles, streaming).
- HuggingFace est simulé par `page.route("https://huggingface.co/api/**")`.
- Les ressources système par `page.route("**/api/v1/system-resources")`.
- Aucun test ne doit appeler un service réel sans l'indiquer explicitement dans la spec.

## 7. Critères de succès

- `npx playwright test` : 0 échec sur la branche principale.
- `go test ./...` : 0 échec ; les tests moteur passent quand les variables sont définies.
- Un échec produit une capture et une trace dans `test-results/`.

## 8. Ajouter un test

1. Ajouter ou réutiliser les `data-testid` nécessaires.
2. Créer `e2e/<écran>.spec.ts` en important `test, expect` depuis `./fixtures`.
3. Mocker les appels réseau de l'écran (ne pas dépendre d'un backend).
4. Mettre à jour la table de la section 5 de ce document.
