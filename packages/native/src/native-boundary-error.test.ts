import { expect, test } from "bun:test"
import {
  HostProtocolMethodNotFoundError,
  HostProtocolPermissionDeniedError,
  HostProtocolUnsupportedError,
  makeHostProtocolHostUnavailableError
} from "@effect-desktop/bridge"
import { Context, Effect, Layer } from "effect"

import {
  decodeNativeBoundaryError,
  encodeNativeBoundaryError,
  NativeBoundaryError,
  NativeBoundaryErrors,
  NativeBoundaryErrorsLive,
  normalizeNativeBoundaryEffect
} from "./index.js"

test("NativeBoundaryErrors test layer proves success and normalized native failure reasons", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const context = yield* Effect.scoped(Layer.build(NativeBoundaryErrorsLive))
      const boundary = Context.get(context, NativeBoundaryErrors)
      const success = yield* boundary.normalize(Effect.succeed("ok"))
      const denied = yield* boundary
        .normalize(
          Effect.fail(
            new HostProtocolPermissionDeniedError({
              tag: "PermissionDenied",
              capability: "native.invoke",
              resource: "Screen.getDisplays",
              message: "denied",
              operation: "Screen.getDisplays",
              recoverable: false
            })
          )
        )
        .pipe(Effect.flip)
      const unsupported = yield* boundary
        .normalize(
          Effect.fail(
            new HostProtocolUnsupportedError({
              tag: "Unsupported",
              reason: "not available on linux",
              message: "unsupported",
              operation: "SafeStorage.set",
              platform: "linux",
              recoverable: false
            })
          )
        )
        .pipe(Effect.flip)
      const missingHostMethod = yield* boundary
        .normalize(
          Effect.fail(
            new HostProtocolMethodNotFoundError({
              tag: "MethodNotFound",
              method: "Native.missing",
              message: "method not found",
              operation: "Native.missing",
              recoverable: false
            })
          )
        )
        .pipe(Effect.flip)
      const hostFailed = yield* boundary
        .normalize(Effect.fail(makeHostProtocolHostUnavailableError("Window.create")))
        .pipe(Effect.flip)

      expect(success).toBe("ok")
      expect(denied).toMatchObject({
        _tag: "NativeBoundaryError",
        reason: "denied",
        hostTag: "PermissionDenied",
        operation: "Screen.getDisplays"
      })
      expect(unsupported).toMatchObject({
        reason: "unsupported",
        hostTag: "Unsupported",
        platform: "linux"
      })
      expect(missingHostMethod).toMatchObject({
        reason: "missing-host-method",
        hostTag: "MethodNotFound",
        method: "Native.missing"
      })
      expect(hostFailed).toMatchObject({
        reason: "host-failed",
        hostTag: "HostUnavailable",
        operation: "Window.create"
      })
    })
  ))

test("NativeBoundaryError decode and encode are Schema-typed tagged effects", () => {
  const error = new NativeBoundaryError({
    reason: "host-failed",
    hostTag: "Internal",
    operation: "Native.test",
    message: "failed",
    recoverable: false
  })

  return Effect.runPromise(
    Effect.gen(function* () {
      const encoded = yield* encodeNativeBoundaryError(error)
      const decoded = yield* decodeNativeBoundaryError(encoded)
      const malformed = yield* decodeNativeBoundaryError({ reason: "host-failed" }).pipe(
        Effect.flip
      )

      expect(decoded).toMatchObject({
        _tag: "NativeBoundaryError",
        reason: "host-failed",
        hostTag: "Internal"
      })
      expect(malformed).toMatchObject({
        _tag: "NativeBoundaryError",
        reason: "invalid-input",
        hostTag: "InvalidArgument",
        operation: "NativeBoundaryError.decode"
      })
    })
  )
})

test("normalizeNativeBoundaryEffect exposes tagged errors without requiring the service", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const error = yield* normalizeNativeBoundaryEffect(
        Effect.fail(makeHostProtocolHostUnavailableError("Native.direct"))
      ).pipe(Effect.flip)

      expect(error).toMatchObject({
        _tag: "NativeBoundaryError",
        reason: "host-failed",
        hostTag: "HostUnavailable"
      })
    })
  ))
