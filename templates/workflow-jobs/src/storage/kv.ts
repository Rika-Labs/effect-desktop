import { BrowserKeyValueStore } from "@effect-desktop/platform-browser"

export const LocalThemeStore = BrowserKeyValueStore.layerLocalStorage
export const SessionThemeStore = BrowserKeyValueStore.layerSessionStorage
