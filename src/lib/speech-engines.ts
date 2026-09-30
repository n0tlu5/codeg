export const RECORDER_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/ogg;codecs=opus",
  "audio/mp4",
]

// The DOM lib shipped with TypeScript has no Web Speech API types.
export interface RecognitionAlternativeLike {
  transcript: string
}
export interface RecognitionResultLike {
  readonly isFinal: boolean
  readonly length: number
  readonly [index: number]: RecognitionAlternativeLike
}
export interface RecognitionEventLike {
  resultIndex: number
  results: ArrayLike<RecognitionResultLike>
}
export interface RecognitionLike {
  continuous: boolean
  interimResults: boolean
  lang: string
  onresult: ((event: RecognitionEventLike) => void) | null
  onerror: ((event: { error: string }) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
  abort(): void
}
export type RecognitionCtor = new () => RecognitionLike

/**
 * True for the errors a recognizer raises when the browser has the API but no
 * speech service behind it (Chromium builds without Google's keys: Chromium,
 * Helium, ungoogled builds). Only meaningful before any result arrived.
 */
export function isRecognitionServiceMissing(error: string): boolean {
  return error === "audio-capture" || error === "network"
}

// Chrome on Android, in continuous mode, re-sends phrases it already finished:
// a final result can repeat the previous phrase, or carry everything said so
// far with the new words at the end. Desktop engines report each phrase once.
export function recognitionRepeatsText(): boolean {
  return (
    typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent)
  )
}

export interface RecognitionText {
  /** Newly finished phrases, each trimmed and non-empty, in order. */
  finals: string[]
  /** The unfinished tail, for display only. */
  interim: string
}

export interface RecognitionTextTracker {
  update(event: RecognitionEventLike): RecognitionText
}

const normalizeWord = (word: string) =>
  word.toLowerCase().replace(/[.,!?;:]+$/u, "")

const splitWords = (text: string) => text.trim().split(/\s+/).filter(Boolean)

/**
 * If `words` opens with a restatement of `reference`, returns how many leading
 * words that restatement spans, else 0. Android rewrites earlier words when it
 * re-sends ("I'd like" becomes "I would like"), so this aligns the two with a
 * word-level LCS instead of demanding an exact prefix: the restatement must
 * reach the reference's last word and keep at least 60% of its words.
 */
function restatedLength(words: string[], reference: string[]): number {
  const r = reference.map(normalizeWord)
  const w = words.map(normalizeWord)
  if (r.length === 0 || w.length === 0) return 0
  // lcs[i][j]: LCS of r[0..i) and w[0..j)
  const lcs = Array.from({ length: r.length + 1 }, () =>
    new Array<number>(w.length + 1).fill(0)
  )
  for (let i = 1; i <= r.length; i += 1) {
    for (let j = 1; j <= w.length; j += 1) {
      lcs[i][j] =
        r[i - 1] === w[j - 1]
          ? lcs[i - 1][j - 1] + 1
          : Math.max(lcs[i - 1][j], lcs[i][j - 1])
    }
  }
  // Earliest end in `words` of an alignment that uses the reference's last word.
  for (let j = 1; j <= w.length; j += 1) {
    if (r[r.length - 1] !== w[j - 1]) continue
    const matched = lcs[r.length - 1][j - 1] + 1
    const needed = r.length === 1 ? 1 : Math.ceil(r.length * 0.6)
    if (matched >= needed && j >= matched) return j
  }
  return 0
}

/**
 * Turns recognition events into text that is safe to append: every final
 * result is delivered at most once, and with `repeatsText` a phrase that
 * restates what was already delivered (whole session so far, or the previous
 * phrase) contributes only its new words.
 */
export function createRecognitionTextTracker(
  repeatsText: boolean
): RecognitionTextTracker {
  let delivered = 0
  let session: string[] = []
  let previous: string[] = []

  const newWords = (words: string[]) => {
    if (!repeatsText) return words
    const restated =
      restatedLength(words, session) || restatedLength(words, previous)
    return words.slice(restated)
  }

  return {
    update({ resultIndex, results }) {
      const finals: string[] = []
      let interim: string[] = []
      for (let i = resultIndex; i < results.length; i += 1) {
        const result = results[i]
        const words = splitWords(result[0]?.transcript ?? "")
        if (!result.isFinal) {
          interim = interim.concat(words)
          continue
        }
        // Desktop keeps one stable slot per phrase, so a slot already read is
        // a re-send. Android may reuse slot 0 for every phrase, so there the
        // text itself decides what is new.
        if (!repeatsText) {
          if (i < delivered) continue
          delivered = i + 1
        }
        const fresh = newWords(words)
        if (fresh.length === 0) continue
        finals.push(fresh.join(" "))
        session = session.concat(fresh)
        previous = words
      }
      return { finals, interim: newWords(interim).join(" ") }
    },
  }
}

export function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null
  const win = window as unknown as Record<string, unknown>
  const ctor = win.SpeechRecognition ?? win.webkitSpeechRecognition
  return typeof ctor === "function" ? (ctor as RecognitionCtor) : null
}

export function pickRecorderMimeType(): string | undefined {
  const isTypeSupported = MediaRecorder.isTypeSupported
  if (typeof isTypeSupported !== "function") return undefined
  return RECORDER_MIME_TYPES.find((type) =>
    isTypeSupported.call(MediaRecorder, type)
  )
}

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = String(reader.result ?? "")
      resolve(dataUrl.slice(dataUrl.indexOf(",") + 1))
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}
