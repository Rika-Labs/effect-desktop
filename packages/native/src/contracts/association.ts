import { Schema } from "effect"
import { BridgeSafeNonEmptyString } from "./strings.js"
import { ProtocolScheme } from "./protocol.js"

const ExtensionPattern = /^\.[A-Za-z0-9][A-Za-z0-9._-]*$/u

export const AssociationFileExtension = Schema.String.check(
  Schema.isPattern(ExtensionPattern),
  Schema.makeFilter((extension) =>
    extension.includes("..") ? "extension must not contain traversal segments" : true
  )
)

export class AssociationProtocolInput extends Schema.Class<AssociationProtocolInput>(
  "AssociationProtocolInput"
)({
  scheme: ProtocolScheme
}) {}

export type AssociationProtocolOptions = Schema.Schema.Type<typeof AssociationProtocolInput>

export class AssociationProtocolStatus extends Schema.Class<AssociationProtocolStatus>(
  "AssociationProtocolStatus"
)({
  scheme: ProtocolScheme,
  isDefault: Schema.Boolean
}) {}

export class AssociationFileAssociationsInput extends Schema.Class<AssociationFileAssociationsInput>(
  "AssociationFileAssociationsInput"
)({
  extensions: Schema.optionalKey(Schema.Array(AssociationFileExtension))
}) {}

export type AssociationFileAssociationsOptions = Schema.Schema.Type<
  typeof AssociationFileAssociationsInput
>

export class AssociationFileAssociation extends Schema.Class<AssociationFileAssociation>(
  "AssociationFileAssociation"
)({
  extension: AssociationFileExtension,
  isDefault: Schema.Boolean
}) {}

export class AssociationFileAssociationsResult extends Schema.Class<AssociationFileAssociationsResult>(
  "AssociationFileAssociationsResult"
)({
  associations: Schema.Array(AssociationFileAssociation)
}) {}

export const AssociationEventPhase = Schema.Literals([
  "protocol-checked",
  "protocol-updated",
  "file-associations-checked",
  "failed"
])

export class AssociationEvent extends Schema.Class<AssociationEvent>("AssociationEvent")({
  phase: AssociationEventPhase,
  reason: Schema.optionalKey(BridgeSafeNonEmptyString)
}) {}
