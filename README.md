# Syllabi — Student Academic Assistant

## Overview

Syllabi is a student-focused web application for managing academic life. Students upload course syllabi (PDF), and the app extracts structured data — events, grading rules, policies, and schedule — using Claude AI. A conversational assistant lets students ask questions about their deadlines, course policies, and schedule across all their courses.

## Design Philosophy

- **Chat-first experience** — the AI assistant is the primary interface
- **Clean, modern, student-friendly design** — white background, indigo/violet accents, soft shadows, rounded corners
- **Mobile-first** — responsive layouts throughout
- **Calm and organized** — designed to reduce academic stress

---

## Tech Stack

- **Frontend**: React 18, TypeScript, Vite, Tailwind CSS v4
- **Routing**: React Router v7 (data mode)
- **Backend**: Supabase (Auth, PostgreSQL, Storage, Edge Functions)
- **UI Components**: Shadcn/UI (Radix UI primitives)
- **AI**: Claude `sonnet-4-6` (syllabus parsing + chat), Claude `haiku-4-5` (lightweight syllabus detection)
- **Other**: date-fns, react-markdown, lucide-react, sonner (toasts)

---

## Quick Start

```bash
cd "Syllabi - Prototype"
npm install
npm run dev     # Vite dev server
npm run build   # Production build
```

**Environment variables** (`.env` in `Syllabi - Prototype/`):

```
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

---

## Routes

| Path | Component | Notes |
|---|---|---|
| `/` | `AuthScreen` | Login / signup |
| `/auth/callback` | `AuthCallback` | Google OAuth redirect handler |
| `/onboarding` | `Onboarding` | First-time setup; protected |
| `/dashboard` | `Dashboard` | Main chat interface; protected |
| `/courses` | `Courses` | Course grid; protected |
| `/course/:id` | `CourseDetail` | Per-course detail; protected |
| `/admin` | `AdminPanel` | Admin only; protected + `is_admin` flag |
| `/settings/canvas` | `CanvasSettings` | Canvas LMS integration; protected |

All routes except `/` and `/auth/callback` are wrapped in `ProtectedRoute`. The admin route additionally checks `profiles.is_admin`.

---

## Key Features

### 1. Authentication

- Email/password signup and signin
- Google OAuth (PKCE flow)
- Email confirmation handling
- New users are routed to Onboarding; returning users go to Dashboard

### 2. Onboarding

Multi-step first-time setup flow (`Onboarding.tsx`):

1. **Upload** — drag-and-drop or file picker for multiple PDFs
2. **Detect** — PDFs sent to `detect-syllabi-info` edge function; Claude extracts course name, code, and semester dates
3. **Review** — user confirms or edits detected courses, grouped by semester
4. **Process** — courses and semesters created in DB; app polls `analysis_status` until complete
5. **Redirect** — `profiles.onboarding_completed` set to `true`; user lands on Dashboard

### 3. Semester Management

- Create/edit/delete semesters (name, start date, end date)
- One active semester at a time; controls which courses appear in chat sidebar
- Semester selector dropdown on Dashboard and Courses page

### 4. Course Management

- Add courses manually or via PDF upload
- Fields: name, code, professor, color (10 presets)
- Bulk upload: upload multiple PDFs at once, detect all courses, review, and create in one flow
- Canvas import: connect to a Canvas LMS instance and import courses directly
- Course cards show status badge (`processing` / `ready` / `failed`) and event count

### 5. Syllabus Parsing

Upload a PDF → `process-syllabus` edge function → Claude `sonnet-4-6` extracts:

- **Course metadata**: name, code, professor
- **Schedule**: meeting days/times, location, semester dates, breaks
- **Events**: assignments, exams, quizzes, presentations — each with `date` (resolved to `YYYY-MM-DD`), `type`, `category`, and `confidence`
- **Grading rules**: components with name, weight, count, drop policy
- **Policies**: attendance, late work, academic integrity, AI policy, recording

Full JSON stored in `courses.syllabus_analysis`; events flattened into `course_events`.

### 6. Course Detail

Tabbed interface (`CourseDetail.tsx`):

| Tab | Contents |
|---|---|
| Events | All extracted events, grouped by date; confidence indicators |
| Grading | Component breakdown with weights; late policy; grading scale |
| Schedule | Meeting days/times, location, instructor info |
| Policies | Attendance, late work, academic integrity, AI, recording, other |
| Notes | Free-text notes per course (max 1,000 chars) |

Quick actions: Chat About This Course, Download Calendar (.ics), Re-upload Syllabus, Delete Course.

### 7. Chat Interface

The Dashboard (`Dashboard.tsx`) is the primary screen:

- **Sidebar — Knowledge Base tab**: course checkboxes, semester selector, quick actions
- **Sidebar — Chat History tab**: previous conversations, rename/delete
- **Message area**: full markdown rendering, timestamps, suggested prompts
- **Feedback**: thumbs down on any AI response to submit feedback

Each conversation is persisted as a `chats` + `chat_messages` record. The `chat` edge function receives the conversation history, selected course IDs, and semester context, and uses query-type detection (date / grading / policy / schedule / general) to fetch only relevant data before calling Claude.

AI can be globally disabled by an admin; the UI respects the `app_settings.ai_enabled` flag.

### 8. Calendar Export

"Download Calendar" on any course detail page calls the `generate-ics` edge function, which builds an RFC 5545 `.ics` file from `course_events` and returns it as a download attachment.

### 9. Canvas LMS Integration

`/settings/canvas` (`CanvasSettings.tsx`):

- Enter Canvas instance URL and personal API token
- Token encrypted with pgcrypto and stored in `profiles.canvas_token_encrypted`
- `find-canvas-courses` edge function fetches courses within a date range
- `find-canvas-syllabus` + `download-canvas-syllabus` locate and pull syllabus PDFs from Canvas modules

### 10. Admin Panel

`/admin` (`AdminPanel.tsx`, admin-only):

- **Overview tab**: toggle AI on/off globally (with confirmation); view usage stats
- **Users tab**: paginated user list with search; powered by `admin-get-users` edge function

---

## Component Architecture

### Pages

| File | Route |
|---|---|
| `src/app/pages/AuthScreen.tsx` | `/` |
| `src/app/pages/AuthCallback.tsx` | `/auth/callback` |
| `src/app/pages/Onboarding.tsx` | `/onboarding` |
| `src/app/pages/Dashboard.tsx` | `/dashboard` |
| `src/app/pages/Courses.tsx` | `/courses` |
| `src/app/pages/CourseDetail.tsx` | `/course/:id` |
| `src/app/pages/AdminPanel.tsx` | `/admin` |
| `src/app/pages/CanvasSettings.tsx` | `/settings/canvas` |

### Modals & Drawers

| File | Purpose |
|---|---|
| `src/app/components/AddCourseModal.tsx` | Create course, upload syllabus, review extracted data |
| `src/app/components/AddSemesterModal.tsx` | Create semester (manual, bulk upload, or Canvas import) |
| `src/app/components/EditSemesterModal.tsx` | Edit/delete existing semester |
| `src/app/components/BulkUploadModal.tsx` | Upload multiple PDFs, detect, review, create |
| `src/app/components/ChatDrawer.tsx` | Compact chat sheet for quick questions |

### Custom Hooks

| File | Purpose |
|---|---|
| `src/app/hooks/useBulkUpload.ts` | Upload PDFs to storage, call `detect-syllabi-info`, manage detected course state |
| `src/app/hooks/useBulkCourseUpload.ts` | Upload multiple syllabi to existing courses |
| `src/app/hooks/useCanvasFlow.ts` | Multi-step Canvas course detection and syllabus download flow |

### Context

`src/app/context/AppContext.tsx` — global state via React Context:

- User auth, profile, `isAdmin`, `onboardingCompleted`
- Semesters (CRUD, active semester)
- Courses (CRUD, `refreshCourses`, `refreshEvents`)
- Events, chat sessions, chat messages, notes
- `aiEnabled`, `chatOpen`

### Routing

`src/app/routes.tsx` — React Router v7 data mode configuration.

### Supabase Client

`src/lib/supabase.ts` — PKCE flow, `isSupabaseConfigured()` helper.

---

## Database Tables (referenced from frontend)

| Table | Purpose |
|---|---|
| `profiles` | User data, `is_admin`, `onboarding_completed`, Canvas credentials |
| `semesters` | Academic terms |
| `courses` | Course info, `analysis_status`, `syllabus_analysis` JSONB |
| `course_events` | Flattened extracted events |
| `course_notes` | User notes per course |
| `chats` | Conversation sessions |
| `chat_courses` | Which courses a chat references |
| `chat_messages` | Per-message history |
| `chat_feedback` | User feedback on AI responses |
| `app_settings` | Global `ai_enabled` kill switch |

---

## Edge Functions (called from frontend)

| Function | Purpose |
|---|---|
| `process-syllabus` | Parse PDF, extract structured data (called on course upload) |
| `detect-syllabi-info` | Lightweight parse for onboarding/bulk upload flow |
| `chat` | AI assistant responses with course/semester context |
| `generate-ics` | Export course events as `.ics` calendar file |
| `find-canvas-courses` | Fetch courses from Canvas instance |
| `find-canvas-syllabus` | Search Canvas modules for syllabus documents |
| `download-canvas-syllabus` | Download syllabus PDF from Canvas and trigger parsing |
| `match-canvas-assignments` | Match Canvas assignments to extracted syllabus events |
| `save-canvas-token` | Encrypt and store Canvas API credentials |
| `delete-canvas-token` | Revoke stored Canvas credentials |
| `admin-get-users` | Paginated user list (admin only) |

---

## Design Tokens

**Colors**
- Primary: `indigo-600` / `violet` accents
- Background: white, `gray-50`, `gray-100`
- Borders: `gray-200`, `gray-300`
- Text: `gray-900` (primary), `gray-600` (secondary), `gray-500` (tertiary)

**Course colors** (10 presets): indigo, violet, pink, salmon, orange, yellow, green, teal, blue, slate

**Spacing**: `p-4`, `p-6`, `p-8`; rounded corners `rounded-lg` → `rounded-2xl` → `rounded-full`
