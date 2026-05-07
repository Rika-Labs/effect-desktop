export type TemplateLocale = "en" | "ar"

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
}

export const templateMessages: Record<TemplateLocale, TemplateCopy> = {
  en: {
    windowTitle: "Effect Desktop template window",
    eyebrow: "basic-react-tailwind",
    title: "Build a desktop renderer with React, Tailwind, and typed Effects.",
    description:
      "This template uses public Effect Desktop hooks and keeps native calls as explicit Effect values, so failures stay observable instead of being thrown from the render path.",
    openWindow: "Open window",
    ready: "Desktop client ready.",
    unavailable: "Desktop client unavailable.",
    running: "Opening window...",
    opened: (windowId) => `Opened ${windowId}.`
  },
  ar: {
    windowTitle: "نافذة قالب Effect Desktop",
    eyebrow: "basic-react-tailwind",
    title: "ابن واجهة سطح مكتب باستخدام React و Tailwind و Effect.",
    description: "يحافظ هذا القالب على استدعاءات النظام كقيم Effect صريحة حتى تبقى الأعطال مرئية.",
    openWindow: "افتح نافذة",
    ready: "عميل سطح المكتب جاهز.",
    unavailable: "عميل سطح المكتب غير متاح.",
    running: "جار فتح النافذة...",
    opened: (windowId) => `تم فتح ${windowId}.`
  }
}
