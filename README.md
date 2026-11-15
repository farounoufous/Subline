# Subline

Sous-titres générés dans le navigateur avec Whisper : en local et hors ligne par défaut (sortie anglaise), ou en ligne sur choix explicite (français ou anglais).

## Développement

```
npm install
npm run build
npm run preview
```

Utiliser `build` + `preview` (pas `npm run dev`) pour tester le chargement des modèles et le mode hors ligne.

## Modes de génération

- **Local** (défaut) : Whisper small dans le navigateur, sous-titres en anglais, privé, hors ligne.
- **En ligne** (choix explicite) : l'audio compressé (MP3 32 kbps, sans l'image) est envoyé par fenêtres de 5 min à l'API Groq (Whisper large-v3, langue détectée automatiquement), puis traduit par un modèle de langage (gpt-oss-120b, avec repli automatique sur les modèles accessibles) vers le français ou l'anglais. La clé API gratuite est celle de l'utilisateur ; elle reste dans son navigateur.

- **Sous-titres intégrés** (choix explicite, vidéos uniquement) : la piste texte d'un MKV/MP4 est extraite avec ffmpeg.wasm (`-map 0:s:N -c:s srt`), lue, puis traduite par le même modèle de langage. Seul le texte part, aucun audio. Les pistes image (PGS, VobSub) sont signalées comme illisibles.
- **Fichiers audio** (MP3, M4A, WAV, FLAC, OGG...) : acceptés par tous les modes ; pas de miniature ni de pistes intégrées.

## Interface, file d'attente et persistance

- **FR/EN** : `src/i18n/` (dictionnaires `fr.js` et `en.js`, fonction `t()`). Langue = navigateur au premier passage, puis mémorisée (`subline:locale`). Toute nouvelle chaîne s'ajoute dans les deux fichiers.
- **File d'attente** : `src/db/useQueue.js`, stockée dans IndexedDB (`queueItems`). Plusieurs fichiers, traitement séquentiel avec les mêmes réglages ; la file s'arrête sur une erreur de quota, de clé ou de réseau.
- **Reprise après rechargement** : réglages (localStorage), historique, progression partielle, file, fichier courant et position de lecture. Sur Chrome/Edge, le `FileSystemFileHandle` est stocké avec chaque fichier : il se rouvre seul si le navigateur a gardé l'autorisation, sinon en un clic. Ailleurs, l'élément reste dans la file et le fichier est à rechoisir.
- **Jamais persisté** : le moteur (local par défaut) et le consentement d'envoi. Une clé API n'est gardée que si « Mémoriser » est coché.
- **Quota Groq** : `src/online/quota.js`. Journal local des secondes d'audio envoyées, croisé avec les limites réelles lues dans les erreurs 429 (« Limit 7200, Used... ») et les en-têtes `x-ratelimit-*` quand le navigateur peut les lire. Limites par défaut : 7 200 s/heure, 28 800 s/jour (palier gratuit documenté).

## Réseau instable, résumé et téléphone

- **Reprise réseau** : `src/online/network.js` + `groqFetch`. Une coupure est réessayée 6 fois (2, 5, 10, 20, 30, 30 s) avec compte à rebours affiché ; hors connexion (`navigator.onLine`), l'appli attend l'évènement `online` sans compter d'essai. La progression est déjà sauvegardée par fenêtre, rien n'est refait.
- **Données envoyées** : `recordBytesSent` (quota.js) compte le corps de chaque requête vers Groq (aujourd'hui, ce mois-ci, par fichier). Estimation : les en-têtes et les réponses ne sont pas comptés.
- **Résumé et chapitres** : `src/online/summary.js`. La transcription est découpée en parties d'environ 9 000 caractères (limite par minute du palier gratuit), chaque partie donne résumé + chapitres, puis un appel fusionne les résumés. Les chapitres hors de l'extrait sont écartés, ceux à moins de 45 s sont fusionnés. Le résultat est stocké avec les sous-titres (champ `outline`). Seul le texte est envoyé.
- **Client de chat partagé** : `createChatClient` (groq-client.js) porte la résolution des modèles et le repli ; le traducteur et le résumé l'utilisent.
- **Téléphone** : `src/utils/device.js` repère les appareils limités (mobile, 4 Go ou moins, 2 cœurs ou moins) : avertissement dans le mode Local avec bouton vers le mode En ligne, un seul worker Whisper. Local reste le mode par défaut. Mise en page adaptée, cibles tactiles agrandies, plein écran natif quand l'élément ne peut pas l'être (iOS).

## Fiabilité (v10.1)

- **Passages en échec** : si Whisper échoue sur un segment (nouvelle tentative, sauf après un délai dépassé), il n'est pas enregistré comme terminé. Un bandeau indique le nombre de passages manquants et propose de les retraiter ; le compte est conservé avec le résultat, donc le bandeau réapparaît après un rechargement. Relancer la génération ne retraite que ces passages.
- **Moteur local bloqué** : après un délai d'inférence dépassé, le worker concerné est arrêté et remplacé (3 remplacements au maximum), au lieu de laisser les segments suivants échouer en cascade.
- **Contre-pression** (`worker-pool.js`, `waitForRoom`) : le décodage attend que la file repasse sous 8 segments ; le décodage avançant par lots, la file peut dépasser brièvement cette limite d'un lot.
- **Filtre d'hallucinations** : formules françaises, frontières Unicode, filtrage avant traduction. Une formule n'est écartée que si elle ouvre ou clôt la ligne ; les boucles ne sont détectées qu'à partir de 8 mots identiques ou 5 répétitions d'un groupe. Détection sans lookbehind (compatible Safari ancien).
- **Mode En ligne** : le délai de la transcription s'adapte à la taille du fichier envoyé (90 s à 10 min, débit minimal de 4 Ko/s), la lecture de la réponse a son propre délai, et un dépassement est traité comme une coupure réseau. La langue détectée est imposée après 3 segments fiables, puis revérifiée tous les 6 morceaux pour détecter un changement de langue.
- **Sous-titres intégrés** : les dessins vectoriels ASS ne sont plus lus comme des répliques (seuls les dessins refermés sont retirés).
- **Quota** : seule la limite quotidienne est affichée ; la limite horaire n'apparaît que si elle est presque atteinte.

## Architecture

- `index.html` : page d'accueil. `app.html` : application (page séparée).
- `src/audio/audio-stream.js` : extraction audio par morceaux (ffmpeg.wasm) + détection de parole (Silero VAD).
- `src/online/` : client Groq (transcription, traduction), quota, pipeline par fenêtres et pipeline des sous-titres intégrés.
- `src/audio/embedded-subtitles.js` : liste et extraction des pistes de sous-titres.
- `src/workers/` : pool de workers Whisper (transformers.js), segments traités dans l'ordre.
- `src/composables/useSubtitleGeneration.js` : orchestration, progression, reprise après interruption.
- `src/utils/` : mise en forme (lignes, durées), filtre d'hallucinations, export SRT/VTT.
- `public/ffmpeg`, `public/onnx-runtime`, `public/vad-assets` : runtimes WASM hébergés localement (hors ligne).

## Déploiement

Les en-têtes COOP/COEP (`vercel.json`) sont requis. Le fichier `public/ffmpeg/ffmpeg-core.wasm` pèse environ 32 Mo : Vercel l'accepte, mais Cloudflare Pages (limite de 25 Mo par fichier) non.
