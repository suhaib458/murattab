import type { UniversityConfig } from "@/domain/models";

export const ttuConfig: UniversityConfig = {
  id: "ttu", name: "جامعة الطفيلة التقنية", timezone: "Asia/Amman",
  dayCodes: { س: "س", ح: "ح", ن: "ن", ث: "ث", ر: "ر", خ: "خ" },
  faculties: [
    { id: "11111111-1111-4111-8111-111111111111", name: "كلية تجريبية", isDevelopmentSeed: true },
    { id: "22222222-2222-4222-8222-222222222222", name: "كلية تجريبية ثانية", isDevelopmentSeed: true }
  ],
  majors: [
    { id: "33333333-3333-4333-8333-333333333333", facultyId: "11111111-1111-4111-8111-111111111111", name: "تخصص تجريبي", isDevelopmentSeed: true },
    { id: "44444444-4444-4444-8444-444444444444", facultyId: "22222222-2222-4222-8222-222222222222", name: "تخصص تجريبي ثانٍ", isDevelopmentSeed: true }
  ]
};
