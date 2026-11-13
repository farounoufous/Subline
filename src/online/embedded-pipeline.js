// Sous-titres intégrés : la piste texte est extraite du fichier puis
// traduite (aucun audio n'est envoyé, seulement le texte des répliques).
// Le résultat est livré par lots, au même format que le pipeline en ligne,
// ce qui donne gratuitement la reprise après interruption et l'affichage
// progressif.

import { t } from '../i18n/index.js'
import { extractSubtitleCues } from '../audio/embedded-subtitles.js'
import { createTranslator, needsTranslation, OnlineError } from './groq-client.js'

const BATCH_CUES = 30
// Marge ajoutée à l'instant de début de la dernière réplique d'un lot : la
// reprise redémarre exactement après elle, sans sauter une réplique
// voisine qui commencerait avant la fin de la précédente.
const RESUME_EPSILON = 0.01

/**
 * @param {File} file
 * @param {{
 *   apiKey: string, targetLanguage: 'fr'|'en', trackIndex: number,
 *   trackLanguage: string|null, signal?: AbortSignal, startAt?: number,
 *   onWindow: Function
 * }} options
 */
export async function runEmbeddedPipeline(file, { apiKey, targetLanguage, trackIndex, trackLanguage, signal, startAt = 0, onWindow }) {
  const cues = await extractSubtitleCues(file, trackIndex, signal)
  if (cues.length === 0) throw new OnlineError('other', t('embedded.empty'))

  const translate = needsTranslation(trackLanguage, targetLanguage)
    ? createTranslator({ apiKey, targetLanguage, signal })
    : null

  const pending = cues.filter((cue) => cue.start >= startAt)
  for (let i = 0; i < pending.length; i += BATCH_CUES) {
    if (signal?.aborted) return
    const batch = pending.slice(i, i + BATCH_CUES)
    const isLast = i + BATCH_CUES >= pending.length
    const texts = translate ? await translate(batch.map((cue) => cue.text)) : batch.map((cue) => cue.text)

    const last = batch[batch.length - 1]
    const horizon = isLast ? Math.max(...batch.map((cue) => cue.end)) : last.start + RESUME_EPSILON

    onWindow({
      startTime: batch[0].start,
      endTime: horizon,
      horizon,
      language: trackLanguage || undefined,
      analyzedSeconds: horizon - batch[0].start,
      clauses: batch.map((cue, k) => ({ text: texts[k], startTime: cue.start, endTime: cue.end, words: [] }))
    })
  }
}
