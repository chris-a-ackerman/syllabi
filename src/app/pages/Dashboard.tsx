import { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router';
import { Calendar, Plus } from 'lucide-react';
import type { UploadTarget } from '@/lib/types';
import { useData } from '../context/DataProvider';
import { Button } from '../components/ui/button';
import { AppHeader } from '../components/AppHeader';
import { AddSemesterModal } from '../components/AddSemesterModal';
import { UploadSyllabusModal } from '../components/UploadSyllabusModal';
import { CourseFormModal } from '../components/CourseFormModal';
import { BulkUploadModal } from '../components/BulkUploadModal';
import { EditSemesterModal } from '../components/EditSemesterModal';
import { DashboardSidebar } from '../components/DashboardSidebar';
import { ChatPanel } from '../components/ChatPanel';
import { useChatRename } from '../hooks/useChatRename';
import { useProcessingPoll } from '../hooks/useProcessingPoll';

export function Dashboard() {
  const { semesters, courses, setActiveSemester, refreshCourses, refreshEvents } = useData();
  const navigate = useNavigate();
  const location = useLocation();
  const rename = useChatRename();

  const [showAddSemester, setShowAddSemester] = useState(false);
  const [showAddCourse, setShowAddCourse] = useState(false);
  const [showCourseForm, setShowCourseForm] = useState(false);
  const [showBulkUpload, setShowBulkUpload] = useState(false);
  const [showEditSemester, setShowEditSemester] = useState(false);
  const [selectedCourseForUpload, setSelectedCourseForUpload] = useState<UploadTarget | undefined>(
    undefined,
  );
  const [showSettings, setShowSettings] = useState(true);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [selectedCourses, setSelectedCourses] = useState<string[]>([]);

  const activeSemester = semesters.find((s) => s.isActive);
  const activeCourses = courses.filter((c) => c.semesterId === activeSemester?.id);
  const processingCount = activeCourses.filter((c) => c.status === 'processing').length;

  // Handle navigation from course detail page
  useEffect(() => {
    const state = location.state as { selectedCourseId?: string } | null;
    if (state?.selectedCourseId) {
      // Select only this course
      setSelectedCourses([state.selectedCourseId]);
      // Open the settings sidebar
      setShowSettings(true);
      // Clear the location state
      navigate(location.pathname, { replace: true, state: {} });
    }
  }, [location.state, navigate, location.pathname]);

  useProcessingPoll(processingCount > 0, refreshCourses);

  // Refresh events once when processing completes (same semester guard)
  const prevProcessingRef = useRef<{ count: number; semesterId: string | undefined }>({
    count: 0,
    semesterId: undefined,
  });
  useEffect(() => {
    const prev = prevProcessingRef.current;
    prevProcessingRef.current = { count: processingCount, semesterId: activeSemester?.id };
    if (prev.count > 0 && processingCount === 0 && prev.semesterId === activeSemester?.id) {
      refreshEvents();
    }
  }, [processingCount, activeSemester?.id, refreshEvents]);

  const toggleCourse = (courseId: string) => {
    setSelectedCourses((prev) =>
      prev.includes(courseId) ? prev.filter((id) => id !== courseId) : [...prev, courseId],
    );
  };

  const toggleAllCourses = () => {
    const readyCourses = activeCourses.filter((c) => c.status === 'ready');
    const allSelected = readyCourses.length > 0 && selectedCourses.length === readyCourses.length;
    setSelectedCourses(allSelected ? [] : readyCourses.map((c) => c.id));
  };

  const closeAddCourse = () => {
    setShowAddCourse(false);
    setSelectedCourseForUpload(undefined);
  };

  if (semesters.length === 0) {
    return (
      <div className="min-h-screen bg-white flex flex-col">
        <AppHeader showFeedbackLink />

        <main className="flex-1 flex items-center justify-center p-8">
          <div className="text-center">
            <div className="mb-6">
              <Calendar className="w-16 h-16 text-indigo-200 mx-auto mb-4" />
              <h2 className="text-2xl font-semibold text-gray-900 mb-2">Welcome to Syllabi!</h2>
              <p className="text-gray-600">Get started by setting up your first semester</p>
            </div>
            <Button
              onClick={() => setShowAddSemester(true)}
              className="bg-indigo-600 hover:bg-indigo-700 rounded-lg"
            >
              <Plus className="mr-2 h-4 w-4" />
              Set Up Your First Semester
            </Button>
          </div>
        </main>

        <AddSemesterModal open={showAddSemester} onClose={() => setShowAddSemester(false)} />
      </div>
    );
  }

  return (
    <div className="h-screen bg-white flex flex-col">
      <AppHeader
        showAdminLink
        showFeedbackLink
        onMenuClick={() => setMobileMenuOpen(true)}
        onAgendaClick={() => navigate('/agenda')}
        onSettingsToggle={() => setShowSettings(!showSettings)}
      />

      <main className="flex-1 flex overflow-hidden">
        {/* Mobile overlay backdrop */}
        {mobileMenuOpen && (
          <div
            className="fixed inset-0 z-40 bg-black/30 md:hidden"
            onClick={() => setMobileMenuOpen(false)}
          />
        )}

        {(showSettings || mobileMenuOpen) && (
          <DashboardSidebar
            activeSemester={activeSemester}
            activeCourses={activeCourses}
            selectedCourses={selectedCourses}
            onToggleCourse={toggleCourse}
            onToggleAllCourses={toggleAllCourses}
            onSemesterChange={(id) => {
              setActiveSemester(id);
              setSelectedCourses([]);
            }}
            rename={rename}
            mobileMenuOpen={mobileMenuOpen}
            onCloseMobileMenu={() => setMobileMenuOpen(false)}
            onAddSemester={() => setShowAddSemester(true)}
            onAddCourse={() => setShowAddCourse(true)}
            onEditSemester={() => setShowEditSemester(true)}
            onUploadSyllabus={(course) => {
              setSelectedCourseForUpload({
                id: course.id,
                name: course.name,
                code: course.code,
                color: course.color,
              });
              setShowAddCourse(true);
            }}
          />
        )}

        <ChatPanel
          activeSemester={activeSemester}
          activeCourses={activeCourses}
          selectedCourses={selectedCourses}
          rename={rename}
          onConfigureKnowledgeBase={() => setShowSettings(true)}
        />
      </main>

      <AddSemesterModal open={showAddSemester} onClose={() => setShowAddSemester(false)} />
      {showEditSemester && activeSemester && (
        <EditSemesterModal
          open={showEditSemester}
          onClose={() => setShowEditSemester(false)}
          semester={activeSemester}
        />
      )}
      <UploadSyllabusModal
        open={showAddCourse}
        onClose={closeAddCourse}
        existingCourse={selectedCourseForUpload}
        onCreateManually={() => {
          setShowAddCourse(false);
          setShowCourseForm(true);
        }}
        onBulkUpload={() => {
          setShowAddCourse(false);
          setShowBulkUpload(true);
        }}
      />
      <CourseFormModal
        open={showCourseForm}
        onClose={() => setShowCourseForm(false)}
        onBack={() => {
          setShowCourseForm(false);
          setShowAddCourse(true);
        }}
        onUploadSyllabus={(course) => {
          setShowCourseForm(false);
          setSelectedCourseForUpload(course);
          setShowAddCourse(true);
        }}
      />
      <BulkUploadModal
        open={showBulkUpload}
        onClose={() => setShowBulkUpload(false)}
        fixedSemesterId={activeSemester?.id ?? ''}
      />
    </div>
  );
}
