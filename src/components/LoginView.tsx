import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  BookOpenCheck,
  Building2,
  CalendarCheck,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  LogIn,
  RefreshCw,
  ShieldCheck,
  User,
  Users,
} from 'lucide-react';
import studentIllustration from '../assets/images/student_cbt_illustration_1794757646794.jpg';
import { loginWithUsernameAndPassword } from '../lib/firestore-service';
import {
  AuthUser,
  ExamLookupResponse,
  PublicPortalInfo,
  UserRole,
} from '../types/cbt';

interface LoginViewProps {
  portalInfo: PublicPortalInfo | null;
  onRefreshPortalInfo: () => Promise<void>;
  onSuccess: (params: {
    user: AuthUser;
    intendedMode: UserRole;
    initialExamLookup?: ExamLookupResponse | null;
  }) => void;
}

function formatPortalClock(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(date.getHours())}.${pad(date.getMinutes())}.${pad(date.getSeconds())}`;
}

function formatPortalDateTime(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}, ${formatPortalClock(date)}`;
}

export function LoginView({
  portalInfo,
  onRefreshPortalInfo,
  onSuccess,
}: LoginViewProps) {
  const [role, setRole] = useState<UserRole>('siswa');
  const [username, setUsername] = useState('');
  const [credential, setCredential] = useState('');
  const [examCode, setExamCode] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [loading, setLoading] = useState(false);
  const [refreshingStatus, setRefreshingStatus] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [imgFailed, setImgFailed] = useState(false);

  const [serverOffsetMs, setServerOffsetMs] = useState(0);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (portalInfo?.serverTime) {
      const serverMs = new Date(portalInfo.serverTime).getTime();
      if (!Number.isNaN(serverMs)) {
        setServerOffsetMs(serverMs - Date.now());
      }
    }
  }, [portalInfo?.serverTime]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  const currentClockDate = useMemo(
    () => new Date(nowMs + serverOffsetMs),
    [nowMs, serverOffsetMs]
  );

  const schoolName = portalInfo?.schoolName || 'SDN 09 SADANIANG';
  const examTheme = portalInfo?.examTheme || 'Tes Akhir Semester';
  const academicYear =
    portalInfo?.academicYear || 'Tahun Pelajaran 2026/2027';
  const footerText = portalInfo?.footerText || '© Fikrul MKC · MKC CBT';
  const stats = portalInfo?.stats || {
    studentCount: 0,
    classCount: 0,
    examCount: 0,
    completedSessionCount: 0,
  };

  const handleRoleSwitch = (nextRole: UserRole) => {
    setRole(nextRole);
    setUsername('');
    setCredential('');
    setShowPassword(false);
    setError(null);
    if (nextRole !== 'siswa') {
      setExamCode('');
    }
  };

  const handleRefreshStatus = async () => {
    setRefreshingStatus(true);
    setStatusMessage(null);
    try {
      await onRefreshPortalInfo();
      setStatusMessage('Status CBT diperbarui.');
      window.setTimeout(() => setStatusMessage(null), 2500);
    } finally {
      setRefreshingStatus(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await loginWithUsernameAndPassword({
        role,
        username,
        credential,
        examCode,
      });

      onSuccess({
        user: res.user,
        intendedMode: role,
        initialExamLookup: res.initialExamLookup,
      });
    } catch (err: any) {
      setError(
        err?.message || 'Gagal masuk. Periksa kembali username dan kata sandi Anda.'
      );
    } finally {
      setLoading(false);
    }
  };

  const isStaffMode = role !== 'siswa';

  return (
    <div className="min-h-screen bg-white flex flex-col text-slate-900">
      {/* Top Emerald School Header */}
      <header className="bg-[#009b4d] text-white px-5 sm:px-10 py-3.5">
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-6">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-white/15 flex items-center justify-center shrink-0">
              <BookOpenCheck className="w-4 h-4 text-white" />
            </div>
            <span className="font-display text-base sm:text-xl font-bold tracking-wide truncate">
              {schoolName}
            </span>
          </div>
          <div className="font-mono text-sm sm:text-base font-medium tabular-nums text-emerald-50 shrink-0">
            {formatPortalClock(currentClockDate)}
          </div>
        </div>
      </header>

      {/* Curved Warm-Accent Sub-Banner for Exam Theme */}
      <div className="relative overflow-hidden bg-[#f8f9fa] border-b border-slate-200/80">
        <svg
          aria-hidden="true"
          viewBox="0 0 1440 80"
          preserveAspectRatio="none"
          className="absolute inset-0 w-full h-full pointer-events-none"
        >
          <path
            d="M0,0 L420,0 C340,55 180,75 0,72 Z"
            fill="#f5e3d1"
            opacity="0.7"
          />
          <path
            d="M780,0 L1440,0 L1440,76 C1220,76 960,55 780,0 Z"
            fill="#f5e3d1"
            opacity="0.6"
          />
        </svg>
        <div className="relative max-w-6xl mx-auto px-5 sm:px-10 py-3 flex flex-wrap items-center justify-between gap-2">
          <p className="font-display text-base sm:text-lg font-bold text-[#1d63b8]">
            {examTheme}
          </p>
          {academicYear && (
            <p className="text-xs sm:text-sm font-medium text-slate-600">
              {academicYear}
            </p>
          )}
        </div>
      </div>

      {/* Main Split Workspace */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-5 sm:px-10 py-8 lg:py-12 grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-14 items-center">
        {/* Left: Illustration & Quiet Footer */}
        <section className="lg:col-span-6 space-y-6">
          <div className="rounded-xl overflow-hidden border border-slate-200 bg-slate-50">
            {!imgFailed ? (
              <img
                src={studentIllustration}
                alt={`Ilustrasi peserta ujian ${schoolName}`}
                referrerPolicy="no-referrer"
                onError={() => setImgFailed(true)}
                className="w-full h-auto max-h-[380px] object-cover block"
              />
            ) : (
              <div className="aspect-[4/3] w-full bg-gradient-to-br from-emerald-50 via-white to-sky-50 flex flex-col items-center justify-center p-8 text-center">
                <BookOpenCheck className="w-12 h-12 text-[#009b4d] mb-3" />
                <p className="font-display text-lg font-bold text-slate-900">
                  {schoolName}
                </p>
                <p className="text-sm text-slate-600 mt-1">{examTheme}</p>
              </div>
            )}
          </div>

          <div className="text-xs text-slate-500">
            <span className="font-semibold text-slate-700">{footerText}</span>
          </div>
        </section>

        {/* Right: Username & Password/PIN Login + Status CBT */}
        <section className="lg:col-span-6 space-y-6">
          <div className="space-y-5">
            {/* Top-right Role Switcher Link */}
            <div className="flex items-center justify-between gap-4">
              <div>
                <h1 className="font-display text-2xl font-bold text-slate-900">
                  {role === 'siswa'
                    ? 'Login Siswa'
                    : role === 'super_admin'
                    ? 'Login Super Admin'
                    : 'Login Guru'}
                </h1>
                <p className="text-sm text-slate-500 mt-1">
                  {role === 'siswa'
                    ? 'Ketik Username/NIS dan PIN peserta ujian sesuai kartu ujian Anda'
                    : role === 'super_admin'
                    ? 'Masuk sebagai Super Admin untuk mengelola guru, siswa, dan pengaturan sekolah'
                    : 'Ketik Username dan Kata Sandi Guru yang diberikan oleh Super Admin'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => handleRoleSwitch(isStaffMode ? 'siswa' : 'guru')}
                className="text-sm font-semibold text-[#1d63b8] hover:text-blue-800 hover:underline whitespace-nowrap shrink-0 cursor-pointer self-start pt-1"
              >
                {isStaffMode ? 'Login Siswa' : 'Login Guru / Admin'}
              </button>
            </div>

            {/* Staff Sub-Tabs when in Guru / Admin Mode */}
            {isStaffMode && (
              <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-lg max-w-xs">
                <button
                  type="button"
                  onClick={() => handleRoleSwitch('guru')}
                  className={`py-1.5 px-3 text-xs font-semibold rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                    role === 'guru'
                      ? 'bg-white text-blue-700 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Akun Guru
                </button>
                <button
                  type="button"
                  onClick={() => handleRoleSwitch('super_admin')}
                  className={`py-1.5 px-3 text-xs font-semibold rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                    role === 'super_admin'
                      ? 'bg-white text-blue-700 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Super Admin
                </button>
              </div>
            )}

            {error && (
              <div
                role="alert"
                className="p-3.5 rounded-lg bg-red-50 border border-red-200 text-red-800 text-sm flex items-start gap-2.5"
              >
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-600" />
                <span>{error}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  {role === 'siswa'
                    ? 'Username / NIS Peserta'
                    : role === 'super_admin'
                    ? 'Username Super Admin'
                    : 'Username Guru'}
                </label>
                <div className="relative">
                  <User className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    required
                    autoComplete="username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder={
                      role === 'siswa'
                        ? 'Contoh: siswa01'
                        : role === 'super_admin'
                        ? 'Contoh: webadmin'
                        : 'Contoh: guru1'
                    }
                    className="w-full pl-10 pr-3.5 py-2.5 rounded-lg border border-slate-300 bg-slate-50/70 text-slate-900 text-sm font-mono lowercase placeholder:normal-case placeholder:font-sans focus:outline-none focus:ring-2 focus:ring-[#009b4d] focus:border-[#009b4d] focus:bg-white"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  {role === 'siswa' ? 'PIN / Kata Sandi' : 'Kata Sandi'}
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    autoComplete="current-password"
                    value={credential}
                    onChange={(e) => setCredential(e.target.value)}
                    placeholder={
                      role === 'siswa'
                        ? 'Ketik PIN peserta (contoh: 123456)'
                        : 'Ketik kata sandi akun Anda'
                    }
                    className="w-full pl-10 pr-10 py-2.5 rounded-lg border border-slate-300 bg-slate-50/70 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#009b4d] focus:border-[#009b4d] focus:bg-white"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((prev) => !prev)}
                    aria-label={
                      showPassword ? 'Sembunyikan sandi' : 'Tampilkan sandi'
                    }
                    className="p-1 text-slate-400 hover:text-slate-700 absolute right-2.5 top-1/2 -translate-y-1/2 cursor-pointer"
                  >
                    {showPassword ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>

              {role === 'siswa' && (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Kode Ujian (Opsional)
                  </label>
                  <div className="relative">
                    <KeyRound className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type="text"
                      aria-label="Kode Ujian (opsional)"
                      value={examCode}
                      onChange={(e) => setExamCode(e.target.value.toUpperCase())}
                      placeholder="Contoh: UJIAN2026 (bisa diisi setelah masuk)"
                      className="w-full pl-10 pr-3.5 py-2.5 rounded-lg border border-slate-300 bg-slate-50/70 text-slate-900 text-sm font-mono uppercase placeholder:normal-case placeholder:font-sans focus:outline-none focus:ring-2 focus:ring-[#009b4d] focus:border-[#009b4d] focus:bg-white"
                    />
                  </div>
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className={`w-full py-3 px-5 disabled:opacity-60 text-white font-semibold text-sm rounded-lg transition-colors flex items-center justify-center gap-2.5 cursor-pointer shadow-sm ${
                  isStaffMode
                    ? 'bg-[#1d63b8] hover:bg-[#175197]'
                    : 'bg-[#009b4d] hover:bg-[#008240]'
                }`}
              >
                <LogIn className="w-4 h-4 shrink-0" />
                <span>
                  {loading
                    ? 'Memverifikasi Akun...'
                    : role === 'siswa'
                    ? 'Masuk ke Portal Ujian'
                    : role === 'super_admin'
                    ? 'Masuk sebagai Super Admin'
                    : 'Masuk sebagai Guru'}
                </span>
              </button>

              <div className="flex items-start gap-2 text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg p-3">
                <ShieldCheck className="w-4 h-4 text-[#009b4d] shrink-0 mt-0.5" />
                <span>
                  {role === 'siswa'
                    ? 'Gunakan Username/NIS dan PIN dari kartu peserta ujian. Jawaban tersimpan otomatis secara real-time.'
                    : role === 'super_admin'
                    ? 'Akun default Super Admin: username "webadmin" dengan kata sandi "webadmin123".'
                    : 'Masuk dengan Username dan Kata Sandi yang telah dibuatkan oleh Super Admin.'}
                </span>
              </div>
            </form>
          </div>

          {/* Live Status CBT Block */}
          <div className="pt-4 border-t border-slate-200 space-y-2.5 text-sm">
            <div className="text-slate-600 font-medium">Status CBT :</div>

            <div className="text-slate-800">
              <span className="font-semibold">Tanggal & Waktu: </span>
              <span className="font-semibold text-[#1d63b8] tabular-nums">
                {formatPortalDateTime(currentClockDate)}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 text-slate-800">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-slate-500 shrink-0" />
                <span>
                  Peserta Terdaftar :{' '}
                  <strong className="text-[#1d63b8] tabular-nums">
                    {stats.studentCount}
                  </strong>
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Building2 className="w-4 h-4 text-slate-500 shrink-0" />
                <span>
                  Jumlah Kelas :{' '}
                  <strong className="text-[#1d63b8] tabular-nums">
                    {stats.classCount}
                  </strong>
                </span>
              </div>
              <div className="flex items-center gap-2">
                <CalendarCheck className="w-4 h-4 text-slate-500 shrink-0" />
                <span>
                  Jadwal Ujian :{' '}
                  <strong className="text-[#1d63b8] tabular-nums">
                    {stats.examCount}
                  </strong>
                </span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-slate-500 shrink-0" />
                <span>
                  Ujian Selesai :{' '}
                  <strong className="text-[#009b4d] tabular-nums">
                    {stats.completedSessionCount}
                  </strong>
                </span>
              </div>
            </div>

            <div className="pt-1 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={handleRefreshStatus}
                disabled={refreshingStatus}
                className="px-4 py-2 bg-[#2583c9] hover:bg-[#1b6da8] disabled:opacity-60 text-white text-xs font-semibold rounded transition-colors inline-flex items-center gap-2 uppercase tracking-wide cursor-pointer whitespace-nowrap"
              >
                <RefreshCw
                  className={`w-3.5 h-3.5 ${refreshingStatus ? 'animate-spin' : ''}`}
                />
                <span>PERBAHARUI STATUS</span>
              </button>
              {statusMessage && (
                <span className="text-xs font-medium text-[#009b4d]">
                  {statusMessage}
                </span>
              )}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
