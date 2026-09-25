# Dossiers partagés, sauvegarde et suivi documentaire

## Diagnostic établi en production

Le projet reste `rguackxuwgskvnquemld`. Le diagnostic du 25 septembre a trouvé trois profils, deux dossiers, deux affectations, deux appels, 72 fichiers reçus et 72 références Storage. L'un des dossiers avait un Advisor mais aucun Responsable affecté ; l'autre avait un Responsable mais aucun Advisor affecté. Aucun filtre créateur ni bucket distinct entre panels n'explique ce cas. Les téléchargements vérifient la même affectation que le détail du dossier.

Les deux affectations croisées ont été explicitement approuvées par le propriétaire. La réparation garde les identifiants de dossiers, clients, appels, fichiers et objets. Le journal `grant.repair.before` conserve les anciennes permissions pour permettre leur restauration. Aucun dossier fusionné, aucune donnée client supprimée ou copiée.

## Cartographie commune

- `meet_clients` → `meet_dossiers.client_id` → appels, documents, fichiers, actions et traitements via `dossier_id`.
- `meet_profiles` et `meet_grants(dossier_id,user_id)` : rôle actif, société autorisée et permission explicite contrôlés par `server/platform.js`.
- `/api/platform` : `list`, `detail`, `call`, `document`, `file-part` pour les deux interfaces ; `create`, `command`, `segments`, `file-*`, `workflow` pour les mutations. Révisions optimistes contre les écrasements concurrents.
- Bucket privé `meet-private`, chemins immuables `dossier/file/part-sha256`. Ni chemins par rôle, ni clés serveur dans le navigateur.
- RLS et absence de privilèges anon/authenticated préservées. RPC privilégiées réservées au rôle serveur. Supervision Admin : lecture seule, société et grant `read,supervise` explicites ; aucun accès ajouté par défaut.

## Changements

- Affectations par listes avec recherche, identifiants stables, validation transactionnelle du compte actif et de la société. Horodatages distincts de connexion et d'activité, sans historique inventé.
- Mot de passe temporaire individuel : huit syllabes aléatoires indépendantes (96 bits), affichage/copie/régénération ponctuels et changement obligatoire. Aucun mot de passe dans les audits.
- Dossier intégré dans la page d'appel, choix des clients existants, détail Responsable actualisé toutes les 30 secondes hors saisie ou dialogue. Révocation nettoyant le détail affiché lors du contrôle suivant.
- IndexedDB v2 conserve chaque fragment de capture puis le convertit atomiquement en lot d'envoi. Conservation des sources confirmées, export de secours, détection d'orphelins propres au compte, échecs isolés par appel. Compteur et reprise utilisent le même filtre ; les tentatives simultanées attendent le même transfert.
- Reprise par fragments de 2 Mio avec identifiants stables. Lecture Storage de contrôle avant confirmation ; les métadonnées seules ne suffisent pas. Réparation des objets manquants depuis la copie locale et absence de renvoi des fragments déjà vérifiés.
- Six phases d'agenda incluant les compléments documentaires, total déterministe pour les six durées. Agenda/profil ajustables sans remise à zéro du temps ni redémarrage. La génération du plan ne bloque plus l'ouverture de l'audio. En repli navigateur, conservation de l'enregistreur disponible.
- Catalogue de catégories de contraintes, occurrences sourcées et règles de niveaux ajustables par un Responsable habilité.
- Demandes documentaires persistées dans le dossier : destinataires confirmés, message, versions et pièces exactes, validation humaine distincte. Toute modification annule l'autorisation. Aucun connecteur de messagerie configuré : aucun statut fictif « envoyé ».
- États explicites des intégrations externes ; exports limités aux dossiers autorisés. Paramètres de structuration financière exclus des instructions actuelles du copilote.

## Migration et validation

`009_assignments_activity.sql` appliquée au projet Supabase existant. Deux affectations ciblées appliquées séparément après accord. Les migrations 001–008 restent conservées et ne doivent pas être rejouées.

79 tests automatisés passent, dont deux sessions applicatives indépendantes sur PostgreSQL PGlite, droits révoqués, mêmes identifiants/octets de fichiers, objet Storage absent malgré les métadonnées, accusé perdu, session expirée, reprise simultanée, permissions de supervision et invalidation des autorisations de diffusion. Storage et fournisseur IA sont simulés dans ces tests. Build local validé et parcours navigateur local contrôlé avec données fictives.

## Limites explicites

- Aucun appel réel de deux heures ni test acoustique en production réalisé. Les lots audio sont fragmentés ; la capacité de conservation dépend du quota du navigateur et doit être mesurée sur les appareils utilisés. Aucun audio ancien jamais persisté ne peut être recréé après fermeture.
- Les comptes opérationnels réels n'ont pas été usurpés pour les tests. Le contrôle de leurs affectations est effectué en base ; le test à deux sessions est isolé.
- Les documents générés restent des brouillons Markdown fondés sur les rubriques réellement cartographiées du corpus. Pas de génération exhaustive fidèle de tous les contrats PDF/DOCX, de signature électronique ou d'opinion juridique automatique.
- Messagerie, réception automatique, n8n et synchronisation Obsidian ne sont pas connectés. Les demandes ne sont pas envoyées et leurs relances ne s'exécutent pas. L'export d'événements existant exige une session autorisée.
- Les règles de contraintes sont configurables par dossier ; aucun catalogue de solutions institutionnelles non fourni n'est inventé. La revue juridique assistée complète reste à qualifier sur des modèles validés.

Références utilisées : [Supabase — téléchargement privé](https://supabase.com/docs/guides/storage/serving/downloads) et [OpenAI — prompts versionnés dans le code](https://developers.openai.com/api/docs/guides/prompting).
