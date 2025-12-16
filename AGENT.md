# RULES
1. Stack: React, Tailwind, Lucide, IndexedDB, Echart.
2. Theme: Global Theme via `useGlobalSettings`. NO hardcoded bg colors.
3. Icons: Lucide (Monotone/Gray only).
4. Settings: Located at Landing Sidebar (Bottom-Left).
5. Caution: Avoid Circular Deps (Use /constants).
6. Storage & Perf:
   - Storage: IndexedDB (Chunked internally). Use `storage-compat.ts`.
   - Upload: Use `useExcelWorker` (One-shot parse in background).
   - UI: Use `VirtualTable` for large lists. NEVER load all rows to memory.
   - Settings: LocalStorage.
7. Hygiene: Modify files directly. NO `_v2` or duplicate files.
8. Aesthetic: "Pro" & Minimal. NO emojis, vibrant colors, or oversized elements.
