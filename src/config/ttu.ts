import type { UniversityConfig } from "@/domain/models";

/**
 * Canonical TTU runtime configuration.
 *
 * Source: https://www.ttu.edu.jo/academics/ (faculties)
 *         https://www.ttu.edu.jo/ttu_overview/departments/financial-directorate/ (programs)
 * Verification date: 2026-09-17
 *
 * IDs are UUID v5 derived from a fixed namespace (see scripts/generate-ttu-ids.ts).
 * They are deterministic and stable across reload / build / backup / restore.
 *
 * No faculty/major here has `isDevelopmentSeed: true` — V1 ships with the production
 * dataset. The legacy placeholder IDs (11111111-…/22222222-…/33333333-…/44444444-…)
 * are NOT in this dataset; legacy profiles are detected and prompted for refresh.
 *
 * OUT OF SCOPE for V1 bachelor onboarding:
 *   الكلية التقنية المتوسطة (middle technical college — diplomas only).
 *   See docs/ttu-data-sources.md.
 */

export const TTU_FACULTY_IDS = {
  engineering: "ffdd572d-5b07-5a48-8e9f-152472421e00",
  science: "e26e405d-7d71-5c96-a78d-14f3ca85d241",
  educationalSciences: "7cc003a0-3e30-50a3-bd19-e75f273a99fa",
  business: "8ad7e858-5849-566f-b908-5f60405a6157",
  arts: "3e52d206-e0fb-513f-9977-4538a6a6a2e1",
  itAndCommunication: "198b8f50-8932-5eea-b267-0b48dfde70fd"
} as const;

export const TTU_MAJOR_IDS = {
  // كلية الهندسة
  engGeological: "31eac165-bc05-58e3-9f02-fd02d0bf1161",
  engMechProduction: "4a5735ba-d4bc-50bd-b6b9-bf1d227922af",
  engMechVehicles: "289a3420-8a90-5ff6-80a3-1acf186c8549",
  engMining: "988890b5-5961-568a-b143-a9997ad17690",
  engElectricalPower: "99acec10-2a5f-58de-a4eb-d8cde7de1673",
  engCivil: "e5f05e90-3809-535c-bb93-8eaea9f47ff3",
  engMechHvac: "3cce48d3-017f-5592-a709-a95a61f9e2fc",
  engMechHybrid: "21ccaa9c-15c1-5896-941c-091a0099d117",
  engIntelligentSystems: "857ed1c5-a01d-517f-9e86-a89b0ef396d4",
  engCommunications: "91fcaca3-9b9a-56ea-a2ff-1feb6ff53b4e",
  engComputer: "86f68830-d393-56e2-b0ee-9d283d80cfa6",
  engChemical: "11ad86d9-7eb8-577c-807e-bd7dda7bb4ef",
  engRenewableEnergy: "954bc10e-1768-5507-865f-b8e6195e0636",
  engMechatronics: "935ecd5f-fba3-594f-b020-82ca8c57152f",
  engMechatronicsRobotics: "0c3ebe95-0766-512a-98fb-8fcd40bbcf77",

  // كلية العلوم
  sciAppliedStats: "bfeee0b7-f558-5777-b34b-ae5f77c8bdf5",
  sciMath: "88455a0c-4c9e-529f-9fee-86ef3ef94a3d",
  sciBasic: "5cded8c8-6be5-58cf-a442-54ce9c78ba7e",
  sciAppliedBiology: "866f0122-98f9-5560-8bcf-0fe2ae8ce7a9",
  sciAppliedPhysics: "9d680a4f-79e1-5733-a184-3c5fd7511750",
  sciBiomedicalPhysics: "e723a309-1690-5847-886c-74cdfaec277a",
  sciChemistry: "91ddae3d-f89a-5144-9c4b-8d755d03e623",
  sciAppliedChemistry: "07b6a8e9-804b-5a7d-947e-c0e74ef1d540",
  sciChemistryTechnology: "b66fb07d-e639-5f0b-9e56-469c25e41775",

  // كلية العلوم التربوية
  eduEducation: "1de2fa6a-4313-5e94-984f-432846d0a029",
  eduSpecialEducation: "d18cd74d-b0be-56b8-82c7-b75359aee45d",
  eduChildhood: "9fb41409-babb-5ead-8fce-653f77324a02",
  eduLearningDifficulties: "d0ffa11e-d6dd-5b24-bc1c-4a9b9ad68c98",
  eduClassroomTeacher: "88f2db12-cc89-5802-ae63-e2a46e822982",
  eduClassroomTeacherEnglish: "f921b42d-540b-52fc-837d-34be05431060",

  // كلية الأعمال
  busBusinessAdmin: "044530d0-ae91-5537-bced-cd384d1cdeb0",
  busSupplyChainLogistics: "37497b1e-42de-5542-b396-a453339f435d",
  busBusinessEconomics: "75ed7f3b-8a91-5e75-9bad-a066caa97943",
  busEconomics: "d0207775-0080-5293-8e00-6b78707dbb98",
  busFinanceBanking: "5bde0648-f670-50a4-8a39-413e66b057ca",
  busAccounting: "89aeea65-524a-5861-94e9-d9d514f9eb6b",
  busFintech: "83d6ea69-6438-57f2-8ba1-94866e6ce21f",

  // كلية الآداب
  artsEnglish: "ecf8ed87-748c-53bd-9437-ca74c8faae78",
  artsArabic: "3eaec730-1056-5998-b7db-4c357e6162f8",

  // كلية تكنولوجيا المعلومات والاتصالات
  itCyberSecurity: "fd903d5c-41c1-5b96-82ae-38b15b418a7d",
  itSmartDevices: "d02afbf0-dd3d-5af9-9717-861526c5012b",
  itAiDataScience: "4d3811d3-7773-5c46-bdb4-373f2deb7222",
  itInformationSystems: "755bb460-c86d-52c4-8ad3-442a10672070"
} as const;

export const ttuConfig: UniversityConfig = {
  id: "ttu",
  name: "جامعة الطفيلة التقنية",
  timezone: "Asia/Amman",
  // dayCodes is intentionally omitted: the canonical alphabet lives in
  // src/domain/models.ts (dayCodes const). UI/import code derives from there.
  faculties: [
    { id: TTU_FACULTY_IDS.engineering, name: "كلية الهندسة", isDevelopmentSeed: false },
    { id: TTU_FACULTY_IDS.science, name: "كلية العلوم", isDevelopmentSeed: false },
    { id: TTU_FACULTY_IDS.educationalSciences, name: "كلية العلوم التربوية", isDevelopmentSeed: false },
    { id: TTU_FACULTY_IDS.business, name: "كلية الأعمال", isDevelopmentSeed: false },
    { id: TTU_FACULTY_IDS.arts, name: "كلية الآداب", isDevelopmentSeed: false },
    { id: TTU_FACULTY_IDS.itAndCommunication, name: "كلية تكنولوجيا المعلومات والاتصالات", isDevelopmentSeed: false }
  ],
  majors: [
    // كلية الهندسة — 15 programs (from official Financial Directorate program/tuition table)
    { id: TTU_MAJOR_IDS.engGeological, facultyId: TTU_FACULTY_IDS.engineering, name: "الهندسة الجيولوجية", isDevelopmentSeed: false },
    { id: TTU_MAJOR_IDS.engMechProduction, facultyId: TTU_FACULTY_IDS.engineering, name: "الهندسة الميكانيكية/الإنتاج والآلات", isDevelopmentSeed: false },
    { id: TTU_MAJOR_IDS.engMechVehicles, facultyId: TTU_FACULTY_IDS.engineering, name: "الهندسة الميكانيكية/المركبات", isDevelopmentSeed: false },
    { id: TTU_MAJOR_IDS.engMining, facultyId: TTU_FACULTY_IDS.engineering, name: "هندسة التعدين", isDevelopmentSeed: false },
    { id: TTU_MAJOR_IDS.engElectricalPower, facultyId: TTU_FACULTY_IDS.engineering, name: "هندسة القوى الكهربائية", isDevelopmentSeed: false },
    { id: TTU_MAJOR_IDS.engCivil, facultyId: TTU_FACULTY_IDS.engineering, name: "الهندسة المدنية", isDevelopmentSeed: false },
    { id: TTU_MAJOR_IDS.engMechHvac, facultyId: TTU_FACULTY_IDS.engineering, name: "الهندسة الميكانيكية/التكييف والتبريد والتدفئة", isDevelopmentSeed: false },
    { id: TTU_MAJOR_IDS.engMechHybrid, facultyId: TTU_FACULTY_IDS.engineering, name: "الهندسة الميكانيكية/تكنولوجيا المركبات الهجينة", isDevelopmentSeed: false },
    { id: TTU_MAJOR_IDS.engIntelligentSystems, facultyId: TTU_FACULTY_IDS.engineering, name: "هندسة الأنظمة الذكية", isDevelopmentSeed: false },
    { id: TTU_MAJOR_IDS.engCommunications, facultyId: TTU_FACULTY_IDS.engineering, name: "هندسة الاتصالات والإلكترونيات", isDevelopmentSeed: false },
    { id: TTU_MAJOR_IDS.engComputer, facultyId: TTU_FACULTY_IDS.engineering, name: "هندسة الحاسوب", isDevelopmentSeed: false },
    { id: TTU_MAJOR_IDS.engChemical, facultyId: TTU_FACULTY_IDS.engineering, name: "هندسة الصناعات الكيميائية", isDevelopmentSeed: false },
    { id: TTU_MAJOR_IDS.engRenewableEnergy, facultyId: TTU_FACULTY_IDS.engineering, name: "هندسة الطاقة المتجددة المتكاملة", isDevelopmentSeed: false },
    { id: TTU_MAJOR_IDS.engMechatronics, facultyId: TTU_FACULTY_IDS.engineering, name: "هندسة الميكاترونيكس", isDevelopmentSeed: false },
    { id: TTU_MAJOR_IDS.engMechatronicsRobotics, facultyId: TTU_FACULTY_IDS.engineering, name: "هندسة الميكاترونيكس والروبوتات", isDevelopmentSeed: false },

    // كلية العلوم — 9 programs
    { id: TTU_MAJOR_IDS.sciAppliedStats, facultyId: TTU_FACULTY_IDS.science, name: "الإحصاء التطبيقي", isDevelopmentSeed: false },
    { id: TTU_MAJOR_IDS.sciMath, facultyId: TTU_FACULTY_IDS.science, name: "الرياضيات", isDevelopmentSeed: false },
    { id: TTU_MAJOR_IDS.sciBasic, facultyId: TTU_FACULTY_IDS.science, name: "العلوم الاساسية", isDevelopmentSeed: false },
    { id: TTU_MAJOR_IDS.sciAppliedBiology, facultyId: TTU_FACULTY_IDS.science, name: "العلوم الحياتية التطبيقية", isDevelopmentSeed: false },
    { id: TTU_MAJOR_IDS.sciAppliedPhysics, facultyId: TTU_FACULTY_IDS.science, name: "الفيزياء التطبيقية", isDevelopmentSeed: false },
    { id: TTU_MAJOR_IDS.sciBiomedicalPhysics, facultyId: TTU_FACULTY_IDS.science, name: "الفيزياء الطبية الحيوية", isDevelopmentSeed: false },
    { id: TTU_MAJOR_IDS.sciChemistry, facultyId: TTU_FACULTY_IDS.science, name: "الكيمياء", isDevelopmentSeed: false },
    { id: TTU_MAJOR_IDS.sciAppliedChemistry, facultyId: TTU_FACULTY_IDS.science, name: "الكيمياء التطبيقية", isDevelopmentSeed: false },
    { id: TTU_MAJOR_IDS.sciChemistryTechnology, facultyId: TTU_FACULTY_IDS.science, name: "تكنولوجيا الكيمياء", isDevelopmentSeed: false },

    // كلية العلوم التربوية — 6 programs
    { id: TTU_MAJOR_IDS.eduEducation, facultyId: TTU_FACULTY_IDS.educationalSciences, name: "التربية", isDevelopmentSeed: false },
    { id: TTU_MAJOR_IDS.eduSpecialEducation, facultyId: TTU_FACULTY_IDS.educationalSciences, name: "التربية الخاصة", isDevelopmentSeed: false },
    { id: TTU_MAJOR_IDS.eduChildhood, facultyId: TTU_FACULTY_IDS.educationalSciences, name: "تربية الطفل", isDevelopmentSeed: false },
    { id: TTU_MAJOR_IDS.eduLearningDifficulties, facultyId: TTU_FACULTY_IDS.educationalSciences, name: "صعوبات التعلم", isDevelopmentSeed: false },
    { id: TTU_MAJOR_IDS.eduClassroomTeacher, facultyId: TTU_FACULTY_IDS.educationalSciences, name: "معلم الصف", isDevelopmentSeed: false },
    { id: TTU_MAJOR_IDS.eduClassroomTeacherEnglish, facultyId: TTU_FACULTY_IDS.educationalSciences, name: "معلم صف / اللغة الانجليزية", isDevelopmentSeed: false },

    // كلية الأعمال — 7 programs
    { id: TTU_MAJOR_IDS.busBusinessAdmin, facultyId: TTU_FACULTY_IDS.business, name: "إدارة الأعمال", isDevelopmentSeed: false },
    { id: TTU_MAJOR_IDS.busSupplyChainLogistics, facultyId: TTU_FACULTY_IDS.business, name: "إدارة سلاسل التزويد واللوجيستيات الرقمية", isDevelopmentSeed: false },
    { id: TTU_MAJOR_IDS.busBusinessEconomics, facultyId: TTU_FACULTY_IDS.business, name: "اقتصاد الأعمال", isDevelopmentSeed: false },
    { id: TTU_MAJOR_IDS.busEconomics, facultyId: TTU_FACULTY_IDS.business, name: "الاقتصاد", isDevelopmentSeed: false },
    { id: TTU_MAJOR_IDS.busFinanceBanking, facultyId: TTU_FACULTY_IDS.business, name: "العلوم المالية والمصرفية", isDevelopmentSeed: false },
    { id: TTU_MAJOR_IDS.busAccounting, facultyId: TTU_FACULTY_IDS.business, name: "المحاسبة", isDevelopmentSeed: false },
    { id: TTU_MAJOR_IDS.busFintech, facultyId: TTU_FACULTY_IDS.business, name: "تكنولوجيا المالية", isDevelopmentSeed: false },

    // كلية الآداب — 2 programs
    { id: TTU_MAJOR_IDS.artsEnglish, facultyId: TTU_FACULTY_IDS.arts, name: "اللغة الانجليزية وآدابها", isDevelopmentSeed: false },
    { id: TTU_MAJOR_IDS.artsArabic, facultyId: TTU_FACULTY_IDS.arts, name: "اللغة العربية وآدابها", isDevelopmentSeed: false },

    // كلية تكنولوجيا المعلومات والاتصالات — 4 programs
    { id: TTU_MAJOR_IDS.itCyberSecurity, facultyId: TTU_FACULTY_IDS.itAndCommunication, name: "الأمن السيبراني", isDevelopmentSeed: false },
    { id: TTU_MAJOR_IDS.itSmartDevices, facultyId: TTU_FACULTY_IDS.itAndCommunication, name: "حوسبة الاجهزة الذكية", isDevelopmentSeed: false },
    { id: TTU_MAJOR_IDS.itAiDataScience, facultyId: TTU_FACULTY_IDS.itAndCommunication, name: "علم الحاسوب /الذكاء الاصطناعي وعلم البيانات", isDevelopmentSeed: false },
    { id: TTU_MAJOR_IDS.itInformationSystems, facultyId: TTU_FACULTY_IDS.itAndCommunication, name: "نظم المعلومات الحاسوبية", isDevelopmentSeed: false }
  ]
};

/**
 * The legacy V0 placeholder UUIDs (used during Foundation).
 * Any StudentProfile whose facultyId/majorId is in this set is considered
 * stale and routed through the non-destructive "Refresh faculty/major" flow.
 */
export const LEGACY_SEED_IDS = new Set<string>([
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
  "33333333-3333-4333-8333-333333333333",
  "44444444-4444-4444-8444-444444444444"
]);

/**
 * Returns true if the given IDs refer to entries present in the current
 * canonical TTU dataset.
 */
export function isResolvableAcademicId(facultyId: string, majorId: string): boolean {
  const faculty = ttuConfig.faculties.find((f) => f.id === facultyId);
  if (!faculty) return false;
  return ttuConfig.majors.some((m) => m.id === majorId && m.facultyId === facultyId);
}

/**
 * True if either ID is one of the legacy V0 placeholder UUIDs.
 * Used to detect profiles that need a non-destructive faculty/major refresh.
 */
export function isLegacyAcademicSelection(facultyId: string | undefined, majorId: string | undefined): boolean {
  if (!facultyId || !majorId) return false;
  return LEGACY_SEED_IDS.has(facultyId) || LEGACY_SEED_IDS.has(majorId);
}
