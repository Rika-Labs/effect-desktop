export type TemplateLocale = "en" | "ar"
export type TemplateDirection = "ltr" | "rtl"

export const DEFAULT_TEMPLATE_LOCALE: TemplateLocale = "en"

export interface TemplateCopy {
  readonly windowTitle: string
  readonly eyebrow: string
  readonly title: string
  readonly description: string
  readonly openWindow: string
  readonly ready: string
  readonly unavailable: string
  readonly running: string
  readonly opened: (windowId: string) => string
  readonly currentWindow: (windowId: string) => string
}

export const templateMessages: Record<TemplateLocale, TemplateCopy> = {
  en: {
    windowTitle: "Effect Desktop basic React Tailwind template",
    eyebrow: "basic-react-tailwind",
    title: "Build a desktop renderer with React, Tailwind, and Effect.",
    description:
      "RPC contracts live in src/contract.ts as Rpc.make and RpcGroup.make. The host spine in src/app.ts wires Desktop.app() with the handler layer.",
    openWindow: "Open window",
    ready: "Desktop client ready.",
    unavailable: "Desktop client unavailable.",
    running: "Opening window...",
    opened: (windowId) => `Opened ${windowId}.`,
    currentWindow: (windowId) => `Current window: ${windowId}`
  },
  ar: {
    windowTitle: "قالب Effect Desktop مع React و Tailwind",
    eyebrow: "basic-react-tailwind",
    title: "ابن واجهة سطح مكتب باستخدام React و Tailwind و Effect.",
    description:
      "تعيش عقود RPC في src/contract.ts باستخدام Rpc.make و RpcGroup.make. ويربط src/app.ts تطبيق Desktop.app() بطبقة المعالجات.",
    openWindow: "افتح نافذة",
    ready: "عميل سطح المكتب جاهز.",
    unavailable: "عميل سطح المكتب غير متاح.",
    running: "جار فتح النافذة...",
    opened: (windowId) => `تم فتح ${windowId}.`,
    currentWindow: (windowId) => `النافذة الحالية: ${windowId}`
  }
}

export interface ResolvedTemplateLocale {
  readonly locale: TemplateLocale
  readonly direction: TemplateDirection
  readonly copy: TemplateCopy
}

export const templateLocaleDirections: Record<TemplateLocale, TemplateDirection> = {
  en: "ltr",
  ar: "rtl"
}

export const resolveTemplateLocale = (
  locale: TemplateLocale = DEFAULT_TEMPLATE_LOCALE
): ResolvedTemplateLocale => ({
  locale,
  direction: templateLocaleDirections[locale],
  copy: templateMessages[locale]
})
