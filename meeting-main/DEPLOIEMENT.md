# Déploiement de meet — ripds777-png

Projet personnel : [ripds777-png/meet](https://github.com/ripds777-png/meet).

Cette version conserve l'application Advisor, ses écrans, son prompteur et sa transcription
Deepgram. Les questions, la préparation, le plan et le compte rendu passent désormais par
**l'API OpenAI**, avec la clé et les crédits du projet OpenAI concerné.

## 1. Mettre à jour le code

1. Décompresse `meeting-main.zip`.
2. Place le contenu du dossier `meeting-main` à la racine de ton dépôt personnel
   [ripds777-png/meet](https://github.com/ripds777-png/meet).
   Ajoute aussi les nouveaux fichiers, notamment **`api/openai.js`** et **`.env.example`**.
3. Enregistre les changements sur la branche reliée à Vercel.

Si le projet est déjà importé dans Vercel, garde ce projet et son domaine pour retrouver les
réglages enregistrés dans le navigateur. S'il n'est pas encore importé :
[vercel.com/new](https://vercel.com/new) → importer **ripds777-png/meet**, avec le préréglage **Other**,
la racine `./` et les commandes de build et de sortie laissées vides, comme dans la version d'origine.

## 2. Configurer les variables serveur

Dans le projet Vercel : **Settings → Environment Variables**. Applique les variables à
**Production**, et aussi à **Preview** si tu utilises les déploiements de prévisualisation.

| Variable | Valeur |
|---|---|
| `OPENAI_API_KEY` | Ta clé créée sur [platform.openai.com/api-keys](https://platform.openai.com/api-keys). |
| `APP_PASSWORD` | Le mot de passe de l'application. Garde la valeur actuelle si tu en as déjà une. |
| `DEEPGRAM_API_KEY` | Garde ta clé Deepgram actuelle pour la transcription et la séparation des voix. |

Les deux modèles suivants sont déjà définis dans le code. Les variables permettent seulement
un changement explicite si nécessaire :

| Variable facultative | Défaut | Utilisation |
|---|---|---|
| `OPENAI_MODEL` | `gpt-6-sol` | Plan, préparation, compte rendu. |
| `OPENAI_MODEL_FAST` | `gpt-6-luna` | Suggestions pendant l'appel. |

Le projet OpenAI doit avoir accès aux modèles choisis et disposer d'un crédit ou d'un quota
utilisable. Les crédits du compte OpenAI ne financent pas la transcription Deepgram.
Sans `DEEPGRAM_API_KEY`, le repli navigateur existant reste disponible, sans séparation des voix.

La clé OpenAI doit rester côté serveur, jamais dans `index.html`.

Le fichier `.env.example` contient les noms des variables, sans aucune clé réelle.
Les options avancées de raisonnement sont décrites dans le README ; pour le premier lancement,
garde les valeurs par défaut.

## 3. Redéployer

Après avoir enregistré les variables : **Deployments → dernier déploiement → Redeploy**.
Assure-toi que ce déploiement contient bien les fichiers de la version OpenAI.

## 4. Vérifier sur l'ordinateur

1. Ouvre l'URL de l'application dans ton navigateur habituel sur **l'ordinateur**.
2. Renseigne le dossier avec un contexte de plus de 10 caractères et choisis la durée.
3. Préviens l'interlocuteur de l'enregistrement et de la transcription, puis coche la case prévue.
4. Démarre le parcours et saisis ton mot de passe `APP_PASSWORD` si demandé.
5. Vérifie que le plan est produit. C'est le premier appel réel à OpenAI : il vérifie davantage
   qu'un simple `ping`, qui n'appelle aucun modèle.
6. Effectue le test de captation et attribue ta voix. L'appel se déroule sur **un téléphone
   séparé en haut-parleur**, à portée du micro de l'ordinateur.
7. Fais un court appel d'essai : présentation de l'advisor, présentation du client, puis questions.
8. Termine l'appel et vérifie le compte rendu ainsi que l'export `.md`.

Les suggestions du sélecteur utilisent un second modèle : ce court appel vérifie également
l'accès à `OPENAI_MODEL_FAST`, qui n'est pas appelé pendant la génération du plan.

## Dépannage

| Message ou symptôme | Vérification |
|---|---|
| `OPENAI_API_KEY est absente` | Ajouter la variable au bon environnement Vercel, puis redéployer. |
| `clé OPENAI_API_KEY invalide ou révoquée` | Remplacer la clé OpenAI et redéployer. Ce n'est pas le mot de passe de l'application. |
| `crédit ou quota API indisponible` | Vérifier la facturation et les limites du projet sur [platform.openai.com](https://platform.openai.com/). |
| `limite de débit atteinte` | Attendre puis réessayer ; vérifier les limites du projet si cela se répète. |
| `modèle introuvable ou inaccessible` | Vérifier le nom du modèle et son accès dans le projet OpenAI ; contrôler les deux variables de modèle. |
| Mot de passe refusé | Comparer avec `APP_PASSWORD` dans Vercel, puis vérifier le redéploiement. |
| Réponse incomplète ou flux interrompu | Vérifier la connexion et réessayer. Un compte rendu partiel n'est pas validé pour l'export. |
| Aucune suggestion pendant l'appel | Vérifier d'abord le contexte et la fin de l'introduction, puis l'accès au modèle rapide. Les erreurs du sélecteur restent silencieuses, comme dans la version initiale. |
| Rien n'est transcrit | Vérifier l'autorisation du micro, sa sélection et le volume du téléphone en haut-parleur. |

## Vérifications en ligne de commande (facultatif)

Dans ces exemples, remplacer le domaine et le mot de passe. Le mot de passe n'est pas la clé API.

```bash
# Santé de l'application et mot de passe : aucun appel OpenAI.
curl -N 'https://VOTRE-DOMAINE/api/openai' \
  -H 'Content-Type: application/json' \
  -H 'x-app-password: VOTRE-MOT-DE-PASSE' \
  -d '{"mode":"ping"}'

# Vérification réelle du plan : consomme des tokens OpenAI.
curl -N 'https://VOTRE-DOMAINE/api/openai' \
  -H 'Content-Type: application/json' \
  -H 'x-app-password: VOTRE-MOT-DE-PASSE' \
  -d '{"mode":"plan","societe":"PWM","duree":30,"contexte":"Appel de qualification pour un projet hôtelier en Suisse."}'

# Vérification réelle du compte rendu : consomme des tokens OpenAI.
curl -N 'https://VOTRE-DOMAINE/api/openai' \
  -H 'Content-Type: application/json' \
  -H 'x-app-password: VOTRE-MOT-DE-PASSE' \
  -d '{"mode":"summary","societe":"PWM","contexte":"Appel de qualification pour un projet hôtelier en Suisse.","transcript":"[00:10] Client : Nous préparons un projet hôtelier. Le montant recherché reste à définir."}'
```

## Lancer les tests et l'application localement

Avec Node.js 22 :

```bash
npm test
```

Les tests sont autonomes, sans installation de dépendances ni clé réelle : les réponses OpenAI
sont simulées. Ils vérifient l'adaptateur, les règles conservées et le lecteur SSE de l'interface.

Pour lancer l'application, utilise Vercel CLI, comme avant la migration : copie `.env.example`
vers `.env.local`, renseigne les variables, puis lance `npm run dev`. Le serveur doit être lancé ;
un double-clic sur `index.html` seul ne suffit pas à faire fonctionner les endpoints `/api`.
