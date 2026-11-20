import { useEffect, useState } from 'react';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { AuditLogView } from './components/AuditLogView';
import { ExamManagementView } from './components/ExamManagementView';
import { ExamModeSettingsView } from './components/ExamModeSettingsView';
import { LoginView } from './components/LoginView';
import { QuestionBankView } from './components/QuestionBankView';
import { ResultsView } from './components/ResultsView';
import { SchoolSettingsView } from './components/SchoolSettingsView';
import { StudentAccountsView } from './components/StudentAccountsView';
import { StudentPortal } from './components/StudentPortal';
import { SuperAdminSettingsView } from './components/SuperAdminSettingsView';
import { TeacherAccountsView } from './components/TeacherAccountsView';
import { TeacherDashboard } from './components/TeacherDashboard';
import { TeacherLayout, TeacherTab } from './components/TeacherLayout';
import { auth } from './lib/firebase';
import {
  getPublicPortalInfoFromFirestore,
  syncSignedInUser,
} from './lib/firestore-service';
import {
  AuthUser,
  ExamLookupResponse,
  PublicPortalInfo,
  UserRole,
} from './types/cbt';

export default function App() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [initialLookup, setInitialLookup] = useState<ExamLookupResponse | null>(
    null
  );
  const [portalInfo, setPortalInfo] = useState<PublicPortalInfo | null>(null);
  const [teacherTab, setTeacherTab] = useState<TeacherTab>('dashboard');
  const [previewStudentMode, setPreviewStudentMode] = useState(false);
  const [booting, setBooting] = useState(true);

  const loadPortalInfo = async () => {
    try {
      const info = await getPublicPortalInfoFromFirestore();
      setPortalInfo(info);
    } catch {
      // ignore fallback
    }
  };

  useEffect(() => {
    loadPortalInfo();
    const unsub = onAuthStateChanged(auth, async (fbUser) => {
      if (!fbUser) {
        setUser(null);
        setInitialLookup(null);
        setPreviewStudentMode(false);
        setBooting(false);
        return;
      }
      try {
        const synced = await syncSignedInUser(fbUser);
        setUser(synced);
        loadPortalInfo();
      } catch (err) {
        console.error('Failed to sync Firebase user:', err);
        setUser(null);
      } finally {
        setBooting(false);
      }
    });
    return () => unsub();
  }, []);

  const handleAuthSuccess = (params: {
    user: AuthUser;
    intendedMode: UserRole;
    initialExamLookup?: ExamLookupResponse | null;
  }) => {
    setInitialLookup(params.initialExamLookup || null);
    setUser(params.user);
    setTeacherTab('dashboard');
    setPreviewStudentMode(
      params.user.role !== 'siswa' &&
        params.intendedMode === 'siswa' &&
        Boolean(params.initialExamLookup)
    );
    loadPortalInfo();
  };

  const handleLogout = async () => {
    setUser(null);
    setInitialLookup(null);
    setPreviewStudentMode(false);
    try {
      await signOut(auth);
    } catch {
      // ignore if already signed out
    }
  };

  if (booting) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-sm font-medium text-slate-500">
          Memuat sistem asesmen MKC CBT...
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <LoginView
        portalInfo={portalInfo}
        onRefreshPortalInfo={loadPortalInfo}
        onSuccess={handleAuthSuccess}
      />
    );
  }

  if (user.role === 'siswa' || previewStudentMode) {
    return (
      <StudentPortal
        user={user}
        initialLookup={initialLookup}
        portalInfo={portalInfo}
        onExitPreview={
          user.role !== 'siswa'
            ? () => {
                setPreviewStudentMode(false);
                setInitialLookup(null);
              }
            : undefined
        }
        onLogout={handleLogout}
      />
    );
  }

  return (
    <TeacherLayout
      user={user}
      activeTab={teacherTab}
      onTabChange={setTeacherTab}
      onPreviewStudent={() => setPreviewStudentMode(true)}
      onLogout={handleLogout}
    >
      {teacherTab === 'dashboard' && (
        <TeacherDashboard onNavigate={setTeacherTab} />
      )}
      {teacherTab === 'questions' && <QuestionBankView user={user} />}
      {teacherTab === 'exams' && <ExamManagementView />}
      {teacherTab === 'exam-mode' && <ExamModeSettingsView />}
      {teacherTab === 'results' && <ResultsView />}
      {teacherTab === 'audit-log' && <AuditLogView />}
      {teacherTab === 'teachers' && user.role === 'super_admin' && (
        <TeacherAccountsView />
      )}
      {teacherTab === 'school-settings' && user.role === 'super_admin' && (
        <SchoolSettingsView
          onUpdated={(settings) => {
            setPortalInfo((prev) =>
              prev
                ? {
                    ...prev,
                    schoolName: settings.schoolName,
                    examTheme: settings.examTheme,
                    academicYear: settings.academicYear,
                    footerText: settings.footerText,
                  }
                : null
            );
            loadPortalInfo();
          }}
        />
      )}
      {teacherTab === 'super-admin-settings' && user.role === 'super_admin' && (
        <SuperAdminSettingsView
          user={user}
          onUserUpdated={(updated) => setUser(updated)}
        />
      )}
      {teacherTab === 'students' && <StudentAccountsView />}
    </TeacherLayout>
  );
}
