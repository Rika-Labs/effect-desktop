import { BrowserKeyValueStore } from "@effect-desktop/react"

export const LocalThemeStore = BrowserKeyValueStore.layerLocalStorage
export const SessionThemeStore = BrowserKeyValueStore.layerSessionStorage
