# Configuration OpenAI — ripds777-png

Projet personnel de [ripds777-png](https://github.com/ripds777-png).

Dépôt : [ripds777-png/meet](https://github.com/ripds777-png/meet).

Version préparée le 24 septembre 2026.

## Résultat

Les traitements IA utilisent OpenAI. L'application conserve son parcours,
son interface, son prompteur, la gestion des dossiers en local, l'export, la transcription
Deepgram et le référentiel métier. La signature personnelle figure dans l'interface, les
métadonnées du projet et la documentation.

| Élément | Adaptation |
|---|---|
| Endpoint IA | `api/openai.js`, API Responses avec flux SSE. |
| Authentification IA | `OPENAI_API_KEY`, côté serveur. |
| Sélecteur | `OPENAI_MODEL_FAST`, défaut `gpt-6-luna`. |
| Plan, préparation, compte rendu | `OPENAI_MODEL`, défaut `gpt-6-sol`. |
| Instructions et règles métier | Conservées ; conversion du format des instructions pour OpenAI. |
| Cache et compteurs | Conversion des compteurs OpenAI vers les événements `usage` existants. |
| Interface | Signature personnelle ajoutée ; parcours et présentation du prompteur conservés. |
| Configuration | `.env.example`, README et guide de déploiement actualisés. |
| Tests | `tests/openai.test.js`, exécutables par `npm test`. |

Les appels utilisent `store: false`. Les modèles par défaut fonctionnent avec
`reasoning.effort: none` pour préserver le comportement sans raisonnement étendu pendant
l'appel. Les modèles et efforts restent configurables. Le modèle de préparation garde un
rôle distinct de celui du sélecteur ; leurs latences et la qualité des suggestions restent
à apprécier pendant un appel réel.

Les plafonds de sortie ont été augmentés pour laisser la place aux objets JSON complets :
plan 4 000, préparation 6 000, sélecteur 2 000, compte rendu 6 000 tokens. Les erreurs, refus et
fins de génération incomplètes sont traités explicitement. Les annulations de requêtes se
propagent au fournisseur. La clé API ne transite jamais par le navigateur.

## Vérifications réalisées

18 tests automatisés passent avec des réponses OpenAI simulées :

- Authentification, validation et `ping` sans consommation de tokens.
- Routage des deux modèles, transmission des instructions et paramètres Responses.
- Plan sur les six durées autorisées, avec une somme exacte des minutes.
- Verrou d'introduction, y compris l'absence d'intervention dans les fragments SSE.
- Statuts des questions, mémoire, pièces, contradictions et branches du préparateur.
- Compte rendu en français, caractères UTF-8 et événements SSE coupés entre plusieurs paquets.
- Compteurs de tokens et de cache.
- Erreurs de clé, de quota, de débit, de modèle, flux incomplets et refus.
- Annulation côté requête et côté lecteur du flux.
- Lecture des réponses avec la fonction réellement présente dans `index.html`.

Les règles métier, les prompts, les normalisations, le CSS et le fonctionnement de Deepgram
sont conservés. La signature personnelle n'altère pas la logique des appels.

**Limites de validation :** les tests ne contactent pas OpenAI ou Deepgram. Aucune clé réelle
n'a été fournie pour cette intervention. Aucun déploiement Vercel ni test acoustique n'a été
réalisé. L'accès aux modèles, la consommation, la latence et la pertinence des réponses doivent
être vérifiés avec un appel d'essai après configuration, selon `DEPLOIEMENT.md`.

## Sources techniques

Documentation technique de référence :

- [Streaming des réponses](https://developers.openai.com/api/docs/guides/streaming-responses)
- [Guide de la famille GPT-6](https://developers.openai.com/api/docs/guides/latest-model)
- [GPT-6 Sol](https://developers.openai.com/api/docs/models/gpt-6-sol)
- [GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna)
- [Formats structurés](https://developers.openai.com/api/docs/guides/structured-outputs)
- [Cache des prompts](https://developers.openai.com/api/docs/guides/prompt-caching)
