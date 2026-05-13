import { Data, Effect, Stream } from "effect"

export class CliStreamError extends Data.TaggedError("CliStreamError")<{
  readonly operation: string
  readonly cause: unknown
}> {}

export interface CliStreamTextOptions {
  readonly operation: string
  readonly maxChars?: number
  readonly truncatedSuffix?: string
}

interface TextAccumulator {
  readonly text: string
  readonly truncated: boolean
}

const DEFAULT_TRUNCATED_SUFFIX = "\n[output truncated]"

export const readCliStreamText = (
  stream: ReadableStream<Uint8Array>,
  options: CliStreamTextOptions
): Effect.Effect<string, CliStreamError, never> =>
  Stream.fromReadableStream({
    evaluate: () => stream,
    onError: (cause) => new CliStreamError({ operation: options.operation, cause })
  }).pipe(
    Stream.decodeText(),
    Stream.runFold(
      () => ({ text: "", truncated: false }) satisfies TextAccumulator,
      appendTextChunk(options.maxChars)
    ),
    Effect.catchDefect((defect) =>
      Effect.fail(new CliStreamError({ operation: options.operation, cause: defect }))
    ),
    Effect.map(({ text, truncated }) =>
      truncated ? `${text}${options.truncatedSuffix ?? DEFAULT_TRUNCATED_SUFFIX}` : text
    )
  )

const appendTextChunk =
  (maxChars: number | undefined) =>
  (state: TextAccumulator, chunk: string): TextAccumulator => {
    if (maxChars === undefined) {
      return { text: state.text + chunk, truncated: state.truncated }
    }
    if (state.text.length >= maxChars) {
      return { text: state.text, truncated: true }
    }

    const text = state.text + chunk
    return text.length <= maxChars
      ? { text, truncated: state.truncated }
      : { text: text.slice(0, maxChars), truncated: true }
  }
