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
- **En ligne** (choix explicite) : l'audio compressé (MP3 32 kbps, sans l'image) est envoyé par fenêtres de 5 min à l'API Groq (Whisper large-v3, langue détectée automatiquement), puis traduit par un modèle Llama (70B avec repli sur 8B) vers le français ou l'anglais. La clé API gratuite est celle de l'utilisateur ; elle reste dans son navigateur.

## Architecture

- `index.html` : page d'accueil. `app.html` : application (page séparée).
- `src/audio/audio-stream.js` : extraction audio par morceaux (ffmpeg.wasm) + détection de parole (Silero VAD).
- `src/online/` : client Groq (transcription, traduction, quotas) et pipeline par fenêtres.
- `src/workers/` : pool de workers Whisper (transformers.js), segments traités dans l'ordre.
- `src/composables/useSubtitleGeneration.js` : orchestration, progression, reprise après interruption.
- `src/utils/` : mise en forme (lignes, durées), filtre d'hallucinations, export SRT/VTT.
- `public/ffmpeg`, `public/onnx-runtime`, `public/vad-assets` : runtimes WASM hébergés localement (hors ligne).

## Déploiement

Les en-têtes COOP/COEP (`vercel.json`) sont requis. Le fichier `public/ffmpeg/ffmpeg-core.wasm` pèse environ 32 Mo : Vercel l'accepte, mais Cloudflare Pages (limite de 25 Mo par fichier) non.
