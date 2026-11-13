# Subline

Sous-titres anglais générés 100% en local dans le navigateur (Whisper), utilisables hors ligne.

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
