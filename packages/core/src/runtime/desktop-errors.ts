import { Data } from "effect"

export type DesktopFramework = "react" | "vue" | "solid" | "next" | "astro" | "unknown"
export type DesktopPublicErrorCategory = "usage" | "configuration" | "contract"

export interface DesktopPublicErrorFields {
  readonly code: string
  readonly category: DesktopPublicErrorCategory
  readonly summary: string
  readonly details: Readonly<Record<string, unknown>>
  readonly actor: string
  readonly remediation: string
  readonly docsUrl: string
}

export class MissingDesktopContextError extends Data.TaggedError("MissingDesktopContextError")<{
  readonly framework: DesktopFramework
  readonly message: string
  readonly code: string
  readonly category: DesktopPublicErrorCategory
  readonly summary: string
  readonly details: Readonly<Record<string, unknown>>
  readonly actor: string
  readonly remediation: string
  readonly docsUrl: string
}> {}

export class MissingDesktopRpcClientError extends Data.TaggedError("MissingDesktopRpcClientError")<{
  readonly framework: DesktopFramework
  readonly message: string
  readonly tag: string
  readonly code: string
  readonly category: DesktopPublicErrorCategory
  readonly summary: string
  readonly details: Readonly<Record<string, unknown>>
  readonly actor: string
  readonly remediation: string
  readonly docsUrl: string
}> {}

export class MissingDesktopRpcsError extends Data.TaggedError("MissingDesktopRpcsError")<{
  readonly message: string
  readonly tags: readonly string[]
  readonly code: string
  readonly category: DesktopPublicErrorCategory
  readonly summary: string
  readonly details: Readonly<Record<string, unknown>>
  readonly actor: string
  readonly remediation: string
  readonly docsUrl: string
}> {}

export class DuplicateDesktopRpcNameError extends Data.TaggedError("DuplicateDesktopRpcNameError")<{
  readonly message: string
  readonly name: string
  readonly tags: readonly string[]
  readonly code: string
  readonly category: DesktopPublicErrorCategory
  readonly summary: string
  readonly details: Readonly<Record<string, unknown>>
  readonly actor: string
  readonly remediation: string
  readonly docsUrl: string
}> {}

const FRAMEWORK_ADAPTER_DOCS =
  "https://github.com/Rika-Labs/effect-desktop/blob/main/docs/typed-apis.md"

export const makeMissingDesktopContextError = (
  framework: DesktopFramework,
  message: string
): MissingDesktopContextError =>
  new MissingDesktopContextError({
    framework,
    message,
    ...publicFields({
      code: "EDESKTOP_MISSING_CONTEXT",
      category: "usage",
      summary: "Desktop framework context is missing.",
      details: { framework },
      actor: "renderer",
      remediation: `Wrap this component in the ${framework} desktop provider before calling useDesktop().`
    })
  })

export const makeMissingDesktopRpcClientError = (
  framework: DesktopFramework,
  tag: string,
  message: string
): MissingDesktopRpcClientError =>
  new MissingDesktopRpcClientError({
    framework,
    tag,
    message,
    ...publicFields({
      code: "EDESKTOP_MISSING_RPC_CLIENT",
      category: "configuration",
      summary: "Renderer RPC client method is missing or has the wrong shape.",
      details: { framework, tag },
      actor: "renderer",
      remediation: `Install a renderer RPC client for ${tag} before using the generated ${framework} endpoint.`
    })
  })

export const makeMissingDesktopRpcsError = (
  tags: readonly string[],
  message: string
): MissingDesktopRpcsError =>
  new MissingDesktopRpcsError({
    tags,
    message,
    ...publicFields({
      code: "EDESKTOP_MISSING_RPCS",
      category: "configuration",
      summary: "The requested RpcGroup is not present in the desktop manifest.",
      details: { tags: [...tags] },
      actor: "application",
      remediation:
        "Register the RpcGroup with Desktop.make({ rpcs: Desktop.rpc(group, handlers) }) (compose multiple via Layer.mergeAll) and pass Desktop.manifest(App) to the framework adapter."
    })
  })

export const makeDuplicateDesktopRpcNameError = (
  name: string,
  tags: readonly string[],
  message: string
): DuplicateDesktopRpcNameError =>
  new DuplicateDesktopRpcNameError({
    name,
    tags,
    message,
    ...publicFields({
      code: "EDESKTOP_DUPLICATE_RPC_ENDPOINT_NAME",
      category: "contract",
      summary: "Multiple RPC tags lower to the same framework endpoint name.",
      details: { name, tags: [...tags] },
      actor: "application",
      remediation: "Rename one RPC method so the final tag segment is unique inside the RpcGroup."
    })
  })

const publicFields = (
  fields: Omit<DesktopPublicErrorFields, "docsUrl">
): DesktopPublicErrorFields => ({
  ...fields,
  docsUrl: FRAMEWORK_ADAPTER_DOCS
})
