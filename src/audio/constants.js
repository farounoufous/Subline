// Constantes partagées entre le décodage audio (VAD) et le worker d'inférence.

export const TARGET_SAMPLE_RATE = 16000

// Durée maximale d'un segment envoyé à Whisper. Les segments viennent
// maintenant du VAD (découpage aux frontières réelles de la parole),
// pas d'un découpage fixe : cette constante ne sert plus qu'à re-découper
// les rares passages de parole continue plus longs que ça (un long
// monologue sans pause détectée), Whisper étant conçu pour des fenêtres
// de 30 secondes maximum.
export const MAX_SEGMENT_DURATION_SECONDS = 28

// Durée de contenu (chronologiquement continue depuis le début) qui
// doit être prête avant de considérer la vidéo "lisible" pendant que
// le reste continue à se générer en arrière-plan.
export const READY_THRESHOLD_SECONDS = 4 * 60

// Règles de lisibilité des sous-titres (inspirées des normes usuelles
// du sous-titrage) : lignes courtes, 2 lignes maximum par bloc, durée
// d'affichage minimale et vitesse de lecture raisonnable.
export const MAX_LINE_CHARS = 42
export const MAX_LINES_PER_BLOCK = 2
export const MIN_SUBTITLE_DURATION_SECONDS = 1.0
export const MAX_READING_CHARS_PER_SECOND = 17

// Pause (entre deux mots) à partir de laquelle on coupe une proposition.
export const CLAUSE_PAUSE_GAP_SECONDS = 0.6

// Taille approximative du modèle Whisper téléchargé au premier usage.
export const MODEL_DOWNLOAD_SIZE_LABEL = '~260 Mo'

// Décodage audio en flux : la piste est extraite et analysée par
// morceaux (STREAM_CHUNK_SECONDS), ce qui évite de charger tout l'audio
// en mémoire et permet de commencer à transcrire dès le premier morceau.
// Chaque morceau est décodé avec un surplus (STREAM_LOOKAHEAD_SECONDS)
// pour ne pas couper en deux une phrase qui chevauche la frontière.
export const STREAM_CHUNK_SECONDS = 5 * 60
export const STREAM_LOOKAHEAD_SECONDS = 20
