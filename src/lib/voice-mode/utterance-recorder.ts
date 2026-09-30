import { speechTranscribe } from "@/lib/api"
import { markBrowserRecognitionBroken } from "@/lib/speech-capabilities"
import {
  blobToBase64,
  createRecognitionTextTracker,
  isRecognitionServiceMissing,
  pickRecorderMimeType,
  recognitionCtor,
  recognitionRepeatsText,
  type RecognitionLike,
} from "@/lib/speech-engines"

export const MAX_UTTERANCE_MS = 60_000

export interface UtteranceRecorder {
  beginUtterance(): void
  /** Resolves with the utterance text, or "" when nothing was captured. */
  endUtterance(): Promise<string>
  /** Discards the utterance; nothing is transcribed or sent. */
  abort(): void
}

export function createUtteranceRecorder(
  engine: "browser" | "cloud",
  stream: MediaStream,
  language: string,
  cloudConfigured = false
): UtteranceRecorder {
  if (engine === "cloud") return createCloudRecorder(stream, language)
  return createBrowserRecorder(
    language,
    cloudConfigured ? () => createCloudRecorder(stream, language) : null
  )
}

export class BrowserRecognitionUnavailableError extends Error {
  constructor() {
    super("browser speech recognition is unavailable")
    this.name = "BrowserRecognitionUnavailableError"
  }
}

function createBrowserRecorder(
  language: string,
  createFallback: (() => UtteranceRecorder) | null
): UtteranceRecorder {
  let recognition: RecognitionLike | null = null
  let finals = ""
  let interim = ""
  // Replaces recognition for good once the browser shows it has no speech
  // service; the utterance in progress moves over with it.
  let fallback: UtteranceRecorder | null = null
  let broken = false

  const release = () => {
    if (!recognition) return
    const current = recognition
    recognition = null
    current.onresult = null
    current.onerror = null
    current.onend = null
    current.abort()
  }

  return {
    beginUtterance() {
      if (fallback) return fallback.beginUtterance()
      if (recognition) return
      const Ctor = recognitionCtor()
      if (!Ctor) return
      finals = ""
      interim = ""
      const next = new Ctor()
      next.continuous = true
      next.interimResults = true
      next.lang = language
      const tracker = createRecognitionTextTracker(recognitionRepeatsText())
      let heard = false
      next.onresult = (event) => {
        heard = true
        const update = tracker.update(event)
        finals = [finals, ...update.finals].filter(Boolean).join(" ")
        interim = update.interim
      }
      next.onerror = (event) => {
        if (heard || !isRecognitionServiceMissing(event.error)) return
        markBrowserRecognitionBroken()
        release()
        broken = true
        if (!createFallback) return
        fallback = createFallback()
        fallback.beginUtterance()
      }
      recognition = next
      try {
        next.start()
      } catch {
        release()
      }
    },
    endUtterance() {
      if (fallback) return fallback.endUtterance()
      if (broken)
        return Promise.reject(new BrowserRecognitionUnavailableError())
      const text = recognition ? `${finals} ${interim}`.trim() : ""
      release()
      return Promise.resolve(text)
    },
    abort() {
      if (fallback) return fallback.abort()
      release()
    },
  }
}

function createCloudRecorder(
  stream: MediaStream,
  language: string
): UtteranceRecorder {
  let recorder: MediaRecorder | null = null
  let chunks: Blob[] = []
  let timer: ReturnType<typeof setTimeout> | null = null
  let onStopped: (() => void) | null = null

  const clearTimer = () => {
    if (timer !== null) clearTimeout(timer)
    timer = null
  }

  return {
    beginUtterance() {
      if (recorder) return
      chunks = []
      const preferred = pickRecorderMimeType()
      const next = preferred
        ? new MediaRecorder(stream, { mimeType: preferred })
        : new MediaRecorder(stream)
      next.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data)
      }
      next.onstop = () => onStopped?.()
      recorder = next
      // The cap only stops capture; the utterance is still transcribed when
      // the host calls endUtterance.
      timer = setTimeout(() => {
        if (next.state !== "inactive") next.stop()
      }, MAX_UTTERANCE_MS)
      next.start()
    },
    endUtterance() {
      const current = recorder
      if (!current) return Promise.resolve("")
      recorder = null
      clearTimer()
      const mimeType = (current.mimeType || "audio/webm").split(";")[0].trim()
      const collect = new Promise<Blob>((resolve) => {
        const finish = () => {
          onStopped = null
          resolve(new Blob(chunks, { type: mimeType }))
        }
        if (current.state === "inactive") finish()
        else {
          onStopped = finish
          current.stop()
        }
      })
      return collect.then(async (blob) => {
        if (blob.size === 0) return ""
        const base64 = await blobToBase64(blob)
        const text = await speechTranscribe(base64, mimeType, language || null)
        return text.trim()
      })
    },
    abort() {
      clearTimer()
      const current = recorder
      recorder = null
      onStopped = null
      chunks = []
      if (!current) return
      current.ondataavailable = null
      current.onstop = null
      if (current.state !== "inactive") current.stop()
    },
  }
}
