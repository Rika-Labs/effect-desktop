import { Layer } from "effect"

export declare const DesktopDeclarationLayerTypeId: unique symbol

export type DesktopDeclarationLayer<Registry, RIn = never, E = never> = Layer.Layer<
  never,
  never,
  Registry
> & {
  readonly [DesktopDeclarationLayerTypeId]?: {
    readonly runtime: RIn
    readonly error: E
  }
}

export const declarationLayer = <Registry, RIn = never, E = never>(
  layer: Layer.Layer<never, never, Registry>
): DesktopDeclarationLayer<Registry, RIn, E> => layer as DesktopDeclarationLayer<Registry, RIn, E>

export const emptyDeclarationLayer = <Registry, RIn = never, E = never>(): DesktopDeclarationLayer<
  Registry,
  RIn,
  E
> => declarationLayer(Layer.empty)

export const mergeDeclarationLayers = <Registry, RIn = never, E = never>(
  layers: ReadonlyArray<DesktopDeclarationLayer<Registry, RIn, E>>
): DesktopDeclarationLayer<Registry, RIn, E> => {
  const [firstLayer, ...remainingLayers] = layers
  return firstLayer === undefined
    ? emptyDeclarationLayer<Registry, RIn, E>()
    : declarationLayer(Layer.mergeAll(firstLayer, ...remainingLayers))
}
