# Syllabi - Student Academic Assistant

## Overview
Syllabi is a student-focused web application that helps students manage their academic life by uploading course syllabi and chatting with an AI to get answers about their schedule, deadlines, and course policies.

## Design Philosophy
- **Clean, modern, student-friendly design** with a white background and indigo/violet accent colors
- **Cards with soft shadows and rounded corners** throughout the interface
- **Mobile-first** but works seamlessly on desktop
- **Calm and organized** interface designed to reduce stress for students
- **Chat-first experience** - conversational AI is the primary interaction method

## Tech Stack
- **Frontend**: React + TypeScript + Tailwind CSS v4
- **Routing**: React Router (Data mode)
- **Backend** (planned): Supabase (auth, database, storage) + Supabase Edge Functions
- **Current State**: UI-only with mock data and local state management

## Key Features

### 1. Authentication
- Simple email/password login
- Clean onboarding experience

### 2. Semester Management
- Users can create and manage multiple semesters
- One active semester at a time
- Semester selector with dropdown

### 3. Course Management
- Add courses to semesters with details:
  - Course name
  - Course code
  - Professor name
  - Color coding for visual organization
- Upload course syllabi (PDF format)
- View all courses in a grid layout
- Filter courses by semester
- Detailed course view with:
  - Course information
  - Assignments list with due dates and point values
  - Course policies
  - Important dates
  - Quick actions (download calendar, re-upload syllabus)

### 4. Chat Interface (Primary Feature)
- **Conversational AI assistant** that students see first after adding courses
- **Knowledge Base Settings** (sidebar):
  - Select which courses to include in the conversation
  - Upload syllabi for courses
  - Quick actions for semester/course management
  - Toggle sidebar visibility
- **Chat Features**:
  - Ask questions about selected courses
  - Pre-populated suggested prompts for common questions
  - Message history with timestamps
  - Context-aware responses based on selected courses
  - Can start course-specific chats from course detail pages

### 5. Navigation & User Flow
- **Dashboard** (Chat-first interface) - Primary screen
- **Courses Page** - Grid view of all courses with semester filtering
- **Course Detail Page** - Detailed view of individual course
- **Admin Page** - For AI configuration (admin users only)

## User Flow Analysis

### Primary User Journey: New Student Setup

#### Step 1: Initial Setup
1. User signs up / logs in
2. Lands on dashboard with no semesters
3. Prompted to "Set Up Your First Semester"
4. Creates semester (e.g., "Spring 2026")

#### Step 2: Adding Courses
1. User clicks "Add Course" from dashboard sidebar or welcome screen
2. Fills in course details in modal:
   - Course name
   - Course code
   - Professor
   - Color selection
3. Can optionally upload syllabus PDF immediately
4. Course appears in dashboard sidebar

#### Step 3: Uploading Syllabi
**Option A - During course creation:**
- Upload syllabus in the add course modal

**Option B - After course creation:**
- From dashboard sidebar: Click "Upload Syllabus" on courses without syllabi
- From courses page: Navigate to course detail and click "Re-upload Syllabus"

#### Step 4: Using the Chat Assistant
1. From dashboard, select which courses to ask about (default: all courses with syllabi)
2. Start conversation by:
   - Clicking a suggested prompt, OR
   - Typing a custom question
3. AI responds based on uploaded syllabi and selected courses
4. Continue conversation to get more details

### Secondary User Journeys

#### Course-Specific Chat
1. User navigates to "View Course Details" from dashboard
2. Views course grid, filters by semester if needed
3. Clicks into specific course detail page
4. Reviews course information, assignments, policies
5. Clicks "Chat About This Course" button
6. Returns to dashboard with only that course selected in knowledge base
7. Settings sidebar opens automatically showing the single course selection

#### Managing Multiple Semesters
1. User creates new semester for upcoming term
2. Switches active semester from dropdown
3. Adds courses to new semester
4. Can view courses from all semesters via Courses page filter

#### Admin Configuration
1. Admin user accesses admin panel via badge in header
2. Configures AI settings (enable/disable, model selection)
3. Returns to dashboard

## Component Architecture

### Pages
- `/src/app/pages/Login.tsx` - Authentication
- `/src/app/pages/Dashboard.tsx` - Main chat interface
- `/src/app/pages/Courses.tsx` - Course grid with semester filter
- `/src/app/pages/CourseDetail.tsx` - Individual course detail view
- `/src/app/pages/Admin.tsx` - AI configuration (admin only)

### Key Components
- `/src/app/components/AddSemesterModal.tsx` - Create semester
- `/src/app/components/AddCourseModal.tsx` - Create course & upload syllabus
- `/src/app/components/ui/*` - Reusable UI components (Button, Card, Input, etc.)

### Context
- `/src/app/context/AppContext.tsx` - Global state management for:
  - User authentication
  - Semesters
  - Courses
  - Events/assignments
  - Chat messages
  - AI configuration

### Routing
- `/src/app/routes.ts` - React Router configuration

## Current State & Recent Updates

### Latest Changes
1. ✅ Redesigned Dashboard as chat-first interface
2. ✅ Created Courses page with grid layout
3. ✅ Added semester dropdown filter for courses
4. ✅ Optimized course upload modal (removed redundant info)
5. ✅ Added grey outline to semester selector for better visibility
6. ✅ Implemented "Chat About This Course" button in course detail page
7. ✅ Course-specific chat pre-selection from navigation

### Mock Data
Currently using mock data for:
- User authentication (login always succeeds)
- Course syllabi parsing (simulated AI extraction)
- Chat responses (simulated AI assistant)
- Sample semesters, courses, and assignments

## Future Backend Integration (Planned)

### Supabase Tables
- `users` - User accounts and profiles
- `semesters` - Academic terms
- `courses` - Course information
- `syllabi` - Uploaded PDF files (Supabase Storage)
- `assignments` - Parsed assignment data
- `chat_messages` - Conversation history
- `settings` - User and AI configuration

### Edge Functions
- PDF parsing and data extraction
- AI chat completions
- Syllabus analysis

## Design Tokens

### Colors
- Primary: Indigo/Violet (`indigo-600`, `indigo-700`)
- Background: White
- Secondary backgrounds: Gray-50, Gray-100
- Borders: Gray-200, Gray-300
- Text: Gray-900 (primary), Gray-600 (secondary), Gray-500 (tertiary)

### Spacing & Layout
- Rounded corners: `rounded-lg`, `rounded-xl`, `rounded-2xl`, `rounded-full`
- Shadows: Soft shadows on cards
- Consistent padding: `p-4`, `p-6`, `p-8`

### Typography
- Headings: Bold, high contrast
- Body text: Regular weight, comfortable line-height
- Code/monospace: For course codes

## Notes for Development

- Keep the chat interface as the primary experience
- Maintain calm, stress-reducing design aesthetic
- Ensure mobile responsiveness throughout
- Use mock data until Supabase is integrated
- Focus on student-centric language and flows
- Prioritize quick access to deadline information

---

## Usage for Claude

Copy and paste this entire document when starting a new conversation with Claude about the Syllabi project. This provides complete context about:
- The application's purpose and design philosophy
- Current features and implementation state
- User flows and interaction patterns
- Technical architecture
- Recent updates and changes

This ensures consistent understanding and maintains design/UX continuity across conversation sessions.
