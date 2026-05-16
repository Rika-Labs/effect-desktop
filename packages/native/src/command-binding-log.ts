import type { CommandRegistryError } from "@effect-desktop/core"
import type { HostProtocolError } from "@effect-desktop/bridge"
import { Predicate } from "effect"

export interface CommandBindingWarningError {
  readonly tag: string
  readonly operation?: string
  readonly commandId?: string
  readonly method?: string
  readonly recoverable?: boolean
}

export const commandBindingWarningError = (
  error: CommandRegistryError | HostProtocolError
): CommandBindingWarningError => {
  const value = asRecord(error)
  return {
    tag: stringField(value, "_tag") ?? stringField(value, "name") ?? "UnknownError",
    ...optionalStringField(value, "operation"),
    ...optionalStringField(value, "commandId"),
    ...optionalStringField(value, "method"),
    ...optionalBooleanField(value, "recoverable")
  }
}

const asRecord = (value: unknown): Record<string, unknown> =>
  Predicate.isObject(value) ? value : {}

const stringField = (value: Record<string, unknown>, key: string): string | undefined =>
  typeof value[key] === "string" ? value[key] : undefined

const optionalStringField = (
  value: Record<string, unknown>,
  key: "operation" | "commandId" | "method"
): Partial<Pick<CommandBindingWarningError, typeof key>> => {
  const field = stringField(value, key)
  return field === undefined ? {} : { [key]: field }
}

const optionalBooleanField = (
  value: Record<string, unknown>,
  key: "recoverable"
): Partial<Pick<CommandBindingWarningError, typeof key>> =>
  typeof value[key] === "boolean" ? { [key]: value[key] } : {}
