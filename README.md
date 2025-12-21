# Real Data Intelligence

A powerful Social Listening Data Intelligence Platform built with a hybrid architecture of React (Core) and Vue (Presentation Tools).

## AI Agent Guidelines (Read This First)

If you are an AI Agent working on this repository, please adhere to the following rules:

1.  **Source of Truth**: The `main` branch contains the latest stable code. Always analyze the existing architecture in `main` before proposing changes.
2.  **Branching Strategy**: Do NOT modify `main` directly. Always checkout a new feature branch (e.g., `feature/new-module` or `fix/bug-name`) before writing code.
3.  **No "Localhost" Assumption**: Do not hallucinate that a local server is running or try to access `localhost` unless explicitly instructed to start the dev server. Focus on static code analysis and implementation.
4.  **Hybrid Architecture**:
    - **Core App**: React + TypeScript (`/src`, `/components`, `/views`).
    - **Presentation Tool (RealPPTX)**: Vue 3 + TypeScript (Sub-module/Integration in `/integrations/realpptx`).

## Architecture

- **Core App (React + TypeScript)**: main application, project management, data tools, Dashboard Magic, and the host shell for Canvas Stars.
- **Canvas Stars (RealPPTX, Vue 3 + TypeScript)**: slide editor built in `integrations/realpptx` and embedded into the Core App via `public/build-reports`.

## Key Modules

- **Management Data**: ingest datasets, manage project tables, export CSV/Excel.
- **Preparation Tools**: cleansing and structural transformation for analytics-ready datasets.
- **Dashboard Magic**: create ECharts widgets/charts designed to stay compatible with Canvas Stars and PPTX export.
- **Canvas Stars**: edit slides, insert dashboard charts, import/export PPTX, export JSON/PDF.
- **AI Agent**: data assistant with Gemini/OpenAI/Claude providers.

## Shared Chart Spec (WYSIWYG)

To keep charts visually consistent across the app, both the Core App and Canvas Stars use:
- `shared/chartSpec`: shared chart payload + ECharts option builder (`@shared/chartSpec`)

## Repository Layout

- `App.tsx`, `views/`, `components/`, `hooks/`, `utils/`, `constants/`: Core App
- `views/DashboardMagic.tsx`: dashboard + chart builder UI (ECharts-based)
- `views/ReportBuilder.tsx` + `views/BuildReports.tsx`: host integration embedding Canvas Stars via iframe
- `integrations/realpptx/`: Canvas Stars (RealPPTX) source
- `public/build-reports/`: built Canvas Stars assets (synced during build)
- `shared/`: shared modules used by both apps
- `workers/`: background processing
- `scripts/`: build utilities (RealPPTX asset sync, translations)

## Tech Stack

- **Core App**: React 19, TypeScript, Vite, Tailwind CSS, Lucide icons
- **Charts**: ECharts (SVG renderer)
- **Canvas Stars**: Vue 3, TypeScript, Pinia, ProseMirror (rich text)
- **PPTX**: `pptxgenjs` (export) and `pptxtojson` (import)
- **Storage**: IndexedDB (Core) + Dexie (Canvas Stars)
- **Deployment**: Vercel

## Development

**Prerequisites:** Node.js 18+

1. Install dependencies (includes `integrations/realpptx` via `postinstall`)
   ```bash
   npm install
   ```

2. Environment variables
   ```bash
   cp .env.example .env.local
   ```
   Set:
   ```
   GEMINI_API_KEY=your_gemini_api_key_here
   ```

3. Run the Core App
   ```bash
   npm run dev
   ```

4. Run Canvas Stars standalone (optional)
   ```bash
   npm --prefix integrations/realpptx run dev
   ```

## Build

```bash
npm run build
```

Build flow:
- Build Canvas Stars (`integrations/realpptx/dist`)
- Sync assets into `public/build-reports` (`scripts/sync-realpptx-assets.mjs`)
- Build Core App (Vite)

## AI Agent Working Agreement

- Use `main` as source of truth.
- Always work on a new branch; never commit directly to `main`.
- Read `AGENT.md` before making changes.
- Keep UI consistent with the existing design system (Tailwind + Lucide icons).
