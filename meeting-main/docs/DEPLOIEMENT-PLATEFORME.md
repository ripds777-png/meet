# Déploiement de la plateforme partagée

Cette évolution remplace le mot de passe partagé par des comptes individuels. Ne pas promouvoir la nouvelle version en production avant d'avoir configuré la base, créé le premier administrateur et testé une connexion. Sans configuration, les nouvelles pages répondent explicitement 503 ; elles ne simulent pas un stockage partagé.

## Services et variables

Créer un projet Supabase dédié en région Europe. Garder le bucket `meet-private` privé. Les navigateurs ne reçoivent ni la clé service-role ni un accès direct aux tables. Les migrations activent RLS sans politique pour les rôles publics et réservent les fonctions SQL au serveur.

Configurer dans Vercel, pour l'environnement réellement testé :

| Variable serveur | Usage |
|---|---|
| `SUPABASE_URL` | URL du projet |
| `SUPABASE_SERVICE_ROLE_KEY` | Clé serveur du projet ; jamais dans le JavaScript public |
| `APP_ORIGIN` | Origine exacte, sans slash final, par exemple `https://meet-amber.vercel.app` |
| `CRON_SECRET` | Secret aléatoire dédié au traitement différé |
| `OPENAI_API_KEY` | Extraction et suggestions existantes |
| `DEEPGRAM_API_KEY` | Jetons éphémères de transcription |

Conserver les éventuelles variables de modèles existantes. Ne pas copier de secrets dans Git, les captures ou les journaux. Pour une prévisualisation, fixer une origine stable distincte et utiliser une base de test. Ne pas connecter une prévisualisation de code non vérifié à des données réelles.

Le mot de passe de la base n'est pas requis par l'application : elle utilise les API Supabase côté serveur. Désactiver les inscriptions publiques dans Supabase Auth ; les comptes applicatifs sont créés par un administrateur. Un compte Auth dépourvu de profil actif n'a aucun accès applicatif.

## Installation

1. Exécuter les fichiers `migrations/001_…sql` à `008_…sql` dans leur ordre numérique, une fois, dans l'éditeur SQL du nouveau projet. Chaque migration est transactionnelle. Conserver la trace des migrations appliquées ; elles ne sont pas toutes rejouables.
2. Exécuter localement `npm ci`, `npm test` puis `npm run build`. Vercel doit utiliser `meeting-main` comme répertoire racine, Node 22 et le répertoire de sortie `public`.
3. Configurer les variables serveur. Ne pas ajouter les fichiers HTML source comme pages statiques publiques : `scripts/build.mjs` produit les modèles des pages protégées.
4. Créer le premier administrateur avec `npm run bootstrap:admin`, après avoir défini localement `INITIAL_ADMIN_EMAIL`, `INITIAL_ADMIN_NAME`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` et `APP_ORIGIN`. Le script refuse de s'exécuter si un administrateur actif existe. Le mot de passe temporaire n'est affiché qu'une fois ; le premier accès impose son changement.
5. L'administrateur initial n'a que le rôle Admin et ne peut pas s'accorder lui-même un rôle opérationnel. Créer les comptes Advisor/Responsable appropriés, leur attribuer les sociétés et les dossiers nécessaires. Aucun email d'invitation n'est envoyé automatiquement.
6. Dans Supabase Vault, enregistrer `meet_worker_url` (URL HTTPS `/api/worker` de l'environnement) et `meet_worker_token` (même secret que `CRON_SECRET`). Exécuter `scripts/scheduler.sql`. Il planifie un appel toutes les 30 secondes, indépendamment des onglets ouverts. Ne pas utiliser un cron Vercel Hobby quotidien pour ce traitement.
7. Vérifier sur un dossier fictif : connexion, changement obligatoire de mot de passe, appel, arrivée des segments, chargement d'une pièce, fermeture d'onglet après sauvegarde, reprise du traitement serveur, version documentaire et bilan. Vérifier les refus d'accès avec un second compte hors périmètre, puis désactiver un compte et vérifier le refus d'une session déjà ouverte.
8. Promouvoir seulement après validation du parcours hébergé. Le rollback du code ne supprime pas la base. Ne pas exécuter de suppression ou réinitialisation des anciennes données.

## Données et reprise

Les appels, transcriptions finales, faits, brouillons versionnés, actions, notifications et journaux sont conservés en base. Les originaux et l'audio sont fragmentés dans un bucket privé ; chaque lecture passe par une vérification de session et de dossier. Les rôles et droits sont relus à chaque requête, y compris après révocation d'une session ou désactivation d'un compte.

IndexedDB conserve temporairement les envois non acquittés, séparés par compte. Cette file est une reprise locale, pas la base partagée. Fermer le navigateur avant l'envoi complet peut laisser des fragments uniquement sur l'appareil ; le message de fin indique les envois restant à reprendre. Un onglet fermé ne peut plus capturer le microphone. Le serveur poursuit les traitements pour les sources déjà reçues.

Les imports historiques sont explicites dans un dossier vide choisi. Les métadonnées de pièces anciennes ne deviennent pas des originaux disponibles : leurs fichiers doivent être réimportés. L'auteur historique et les locuteurs importés restent à confirmer. Conserver les anciennes clés locales avant et après la bascule.

Les traitements utilisent des clés d'idempotence, des leases et une révision du dossier. Un résultat périmé ne remplace pas une correction récente. Les segments tardifs déclenchent une nouvelle synthèse ; les lots d'extraction sont bornés par taille de texte. Une erreur laisse un état à reprendre, jamais une réussite présumée.

## Exploitation et limites à valider avant usage réel

- Définir et documenter une durée de conservation, les responsables des suppressions et un plan de sauvegarde/restauration. Aucune purge automatique n'est activée. La sauvegarde SQL seule ne sauvegarde pas les objets Storage ; prévoir les deux et tester une restauration.
- Le plan gratuit a des quotas et des règles de disponibilité à vérifier dans le tableau de bord. Surveiller taille de base, stockage audio, nombre de jobs en attente et erreurs du planificateur. Aucun achat ou changement de plan n'est automatisé.
- Les PDF texte, DOCX, TXT et Markdown sont extraits avec provenance. Les scans n'ont pas d'OCR ; les formats non pris en charge et les pièces de plus de 10 Mo restent conservés pour examen manuel. L'envoi accepte des pièces jusqu'à 50 Mo.
- La couverture des rubriques documentaires reste celle de `COUVERTURE-DOCUMENTS.md`. Le statut « Complet » décrit uniquement les rubriques cartographiées, pas une validation juridique, la totalité du formulaire original ou une signature.
- Les versions générées et validées sont conservées. Le workflow de documents émis/signés, le paramétrage des modèles institutionnels, la classification avancée et la politique de conservation administrable restent à compléter. Ne pas présenter ces fonctions comme disponibles.
- L'export n8n produit un JSON soumis aux mêmes droits. Aucun envoi webhook, email ou notification externe n'est activé.
- Les tests locaux ne remplacent pas un essai réel d'appel long, les coupures réseau, la charge concurrente ou la vérification des quotas de l'environnement Supabase/Vercel. Ces validations hébergées restent requises avant mise en service.

Références officielles : [Supabase Cron](https://supabase.com/docs/guides/cron), [Vault](https://supabase.com/docs/guides/database/vault), [limites Vercel](https://vercel.com/docs/functions/limitations).
