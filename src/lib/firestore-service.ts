import {
  User as FirebaseUser,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
} from 'firebase/auth';
import {
  Timestamp,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { AuthUser, ExamLookupResponse, PublicPortalInfo, UserRole } from '../types/cbt';
import {
  OperationType,
  auth,
  db,
  handleFirestoreError,
  provisioningAuth,
} from './firebase';

const BOOTSTRAP_ADMIN_EMAIL = 'izanalhuda@gmail.com';
const SUPER_ADMIN_INTERNAL_EMAIL = 'webadmin@mkccbt.local';
const INTERNAL_AUTH_DOMAIN = 'mkccbt.local';

function toInternalAuthEmail(username: string): string {
  const clean = username
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '');
  return `${clean}@${INTERNAL_AUTH_DOMAIN}`;
}

function toStudentAuthPassword(pin: string): string {
  return `mkc_pin_${pin.trim()}`;
}

function getProviderNotAllowedError(): Error {
  return new Error(
    'Login Username & Password membutuhkan provider Email/Password aktif di Firebase Console. Buka Authentication > Sign-in method di Firebase Console proyek Anda lalu aktifkan "Email/Password".'
  );
}

async function provisionAuthUserWithoutSigningOut(
  email: string,
  password: string
): Promise<string | null> {
  try {
    const cred = await createUserWithEmailAndPassword(
      provisioningAuth,
      email,
      password
    );
    const uid = cred.user.uid;
    await signOut(provisioningAuth).catch(() => undefined);
    return uid;
  } catch (err: any) {
    await signOut(provisioningAuth).catch(() => undefined);
    if (err?.code === 'auth/email-already-in-use') {
      return null;
    }
    if (err?.code === 'auth/operation-not-allowed') {
      throw getProviderNotAllowedError();
    }
    throw err;
  }
}

let seqCounter = 1;
function nextNumericId(): number {
  seqCounter = (seqCounter % 900) + 1;
  return (Date.now() % 1000000000) * 1000 + seqCounter;
}

function toIso(val: unknown): string {
  if (!val) return new Date().toISOString();
  if (val instanceof Timestamp) return val.toDate().toISOString();
  if (typeof (val as any)?.toDate === 'function') {
    return (val as any).toDate().toISOString();
  }
  if (val instanceof Date) return val.toISOString();
  if (typeof val === 'string') return val;
  return new Date().toISOString();
}

function toMs(val: unknown): number {
  if (!val) return 0;
  if (val instanceof Timestamp) return val.toMillis();
  if (typeof (val as any)?.toMillis === 'function') {
    return (val as any).toMillis();
  }
  if (val instanceof Date) return val.getTime();
  if (typeof val === 'number') return val;
  if (typeof val === 'string') return new Date(val).getTime() || 0;
  return 0;
}

export function emailToKey(email: string): string {
  return email.trim().toLowerCase().replace(/[^a-z0-9]/g, '_');
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function shuffleArray<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function sanitizeText(val: unknown, maxLen: number): string {
  return String(val ?? '')
    .trim()
    .slice(0, maxLen);
}

function normalizeExamCode(code: unknown): string {
  return String(code ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, '')
    .slice(0, 32);
}

function isStudentClassEligible(
  studentClass: string | null | undefined,
  targetClasses: string[]
): boolean {
  if (!targetClasses || targetClasses.length === 0) return true;
  const norm = (studentClass || '').trim().toLowerCase();
  if (!norm) return false;
  return targetClasses.some((c) => c.trim().toLowerCase() === norm);
}

function isCurrentUserAdminEmail(): boolean {
  const email = (auth.currentUser?.email || '').toLowerCase();
  if (email === BOOTSTRAP_ADMIN_EMAIL && auth.currentUser?.emailVerified === true) {
    return true;
  }
  return email === SUPER_ADMIN_INTERNAL_EMAIL;
}

async function getCurrentAuthProfile(): Promise<AuthUser> {
  const fbUser = auth.currentUser;
  if (!fbUser) {
    throw new Error('Sesi tidak ditemukan. Silakan masuk kembali.');
  }
  const userPath = `users/${fbUser.uid}`;
  let snap;
  try {
    snap = await getDoc(doc(db, 'users', fbUser.uid));
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, userPath);
  }
  if (!snap.exists()) {
    return syncSignedInUser(fbUser);
  }
  const d = snap.data();
  return {
    id: Number(d.numericId) || 1,
    uid: fbUser.uid,
    username: d.username,
    name: d.name,
    email: fbUser.email || null,
    role: (d.role as UserRole) || 'siswa',
    className: d.className || '',
  };
}

let seedDoneForSession = false;

async function ensureDemoSeededForAdmin(adminUser: AuthUser): Promise<void> {
  if (seedDoneForSession || adminUser.role !== 'super_admin') return;
  seedDoneForSession = true;

  try {
    const portalSnap = await getDoc(doc(db, 'portalSettings', 'main'));
    if (!portalSnap.exists()) {
      await setDoc(doc(db, 'portalSettings', 'main'), {
        schoolName: 'SDN 09 SADANIANG',
        examTheme: 'Tes Akhir Semester',
        academicYear: 'Tahun Pelajaran 2026/2027',
        footerText: '© Fikrul MKC · MKC CBT',
        studentCount: 3,
        classCount: 2,
        examCount: 1,
        completedSessionCount: 0,
        updatedAt: serverTimestamp(),
      });
    }

    // Seed demo teacher guru1 / Guru123! if teacherInvites is empty
    const existingInvites = await getDocs(collection(db, 'teacherInvites'));
    if (existingInvites.empty) {
      const guruEmail = toInternalAuthEmail('guru1');
      const guruInviteId = emailToKey(guruEmail);
      const guruNumId = nextNumericId();
      const guruUid = await provisionAuthUserWithoutSigningOut(
        guruEmail,
        'Guru123!'
      ).catch(() => null);

      const tBatch = writeBatch(db);
      tBatch.set(doc(db, 'teacherInvites', guruInviteId), {
        id: guruInviteId,
        numericId: guruNumId,
        username: 'guru1',
        name: 'Ibu Sari Wulandari, S.Pd.',
        email: 'sari.wulandari@sekolah.sch.id',
        className: 'Pengajar Informatika & Matematika',
        createdByUid: adminUser.uid,
        createdAt: serverTimestamp(),
      });
      if (guruUid) {
        tBatch.set(doc(db, 'users', guruUid), {
          uid: guruUid,
          numericId: guruNumId,
          username: 'guru1',
          name: 'Ibu Sari Wulandari, S.Pd.',
          role: 'guru',
          className: 'Pengajar Informatika & Matematika',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
      await tBatch.commit();
    }

    // Seed demo students if studentRoster is empty
    const existingRoster = await getDocs(collection(db, 'studentRoster'));
    if (existingRoster.empty) {
      const sampleStudents = [
        { username: 'siswa01', name: 'Ahmad Fauzi', className: 'XII IPA 1', pin: '123456' },
        { username: 'siswa02', name: 'Nadia Putri Pratama', className: 'XII IPA 1', pin: '123456' },
        { username: 'siswa03', name: 'Budi Santoso', className: 'XII IPA 2', pin: '123456' },
      ];
      const sBatch = writeBatch(db);
      for (let i = 0; i < sampleStudents.length; i += 1) {
        const s = sampleStudents[i];
        const numId = nextNumericId() + i;
        const rosterId = `roster_${numId}`;
        const stuUid = await provisionAuthUserWithoutSigningOut(
          toInternalAuthEmail(s.username),
          toStudentAuthPassword(s.pin)
        ).catch(() => null);
        sBatch.set(doc(db, 'studentRoster', rosterId), {
          id: rosterId,
          numericId: numId,
          username: s.username,
          name: s.name,
          className: s.className,
          accessPin: s.pin,
          createdByUid: adminUser.uid,
          createdAt: serverTimestamp(),
        });
        if (stuUid) {
          sBatch.set(doc(db, 'users', stuUid), {
            uid: stuUid,
            numericId: numId,
            username: s.username,
            name: s.name,
            role: 'siswa',
            className: s.className,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
      }
      await sBatch.commit();
    }

    const existingQuestions = await getDocs(collection(db, 'questions'));
    if (!existingQuestions.empty) return;

    const batch = writeBatch(db);

    const qDefs = [
      {
        subject: 'Informatika & Literasi Digital',
        type: 'pg',
        prompt:
          'Dalam sistem basis data, mengapa aplikasi ujian berbasis komputer (CBT) menggunakan timer yang disinkronkan dengan waktu server?',
        options: [
          { key: 'A', text: 'Agar animasi jam berjalan lebih cepat' },
          {
            key: 'B',
            text: 'Untuk mencegah manipulasi waktu apabila siswa mengubah jam lokal pada perangkatnya',
          },
          { key: 'C', text: 'Supaya browser tidak memerlukan koneksi internet' },
          { key: 'D', text: 'Karena HTML tidak mendukung perhitungan mundur' },
        ],
        correctAnswer: 'B',
        points: 20,
        difficulty: 'mudah',
      },
      {
        subject: 'Informatika & Literasi Digital',
        type: 'pg',
        prompt:
          'Mekanisme keamanan pada Firebase Firestore yang memverifikasi hak akses baca dan tulis langsung di server sebelum data dikirim ke klien adalah...',
        options: [
          { key: 'A', text: 'Firestore Security Rules' },
          { key: 'B', text: 'CSS Grid Layout' },
          { key: 'C', text: 'LocalStorage Cache' },
          { key: 'D', text: 'Browser History API' },
        ],
        correctAnswer: 'A',
        points: 20,
        difficulty: 'mudah',
      },
      {
        subject: 'Informatika & Literasi Digital',
        type: 'benar_salah',
        prompt:
          'Pernyataan: Browser web standar dapat mengunci sistem operasi perangkat siswa 100% tanpa bantuan aplikasi kiosk atau perangkat terkelola.',
        options: [],
        correctAnswer: 'SALAH',
        points: 15,
        difficulty: 'sedang',
      },
      {
        subject: 'Informatika & Literasi Digital',
        type: 'benar_salah',
        prompt:
          'Pernyataan: Fitur autosave berkala menjaga agar jawaban siswa tetap tersimpan saat terjadi gangguan jaringan sementara.',
        options: [],
        correctAnswer: 'BENAR',
        points: 15,
        difficulty: 'mudah',
      },
      {
        subject: 'Informatika & Literasi Digital',
        type: 'isian',
        prompt:
          'Singkatan dari Computer Based Test dalam pelaksanaan asesmen digital adalah ____ (3 huruf).',
        options: [],
        correctAnswer: 'CBT',
        points: 15,
        difficulty: 'mudah',
      },
      {
        subject: 'Informatika & Literasi Digital',
        type: 'uraian',
        prompt:
          'Jelaskan dua manfaat fitur autosave berkala pada aplikasi asesmen digital bagi siswa yang mengalami gangguan jaringan internet.',
        options: [],
        correctAnswer:
          'Rubrik: (1) Progres jawaban tidak hilang saat koneksi terputus; (2) Siswa dapat melanjutkan ujian tanpa mengulang dari awal.',
        points: 15,
        difficulty: 'sulit',
      },
    ];

    const createdQIds: number[] = [];
    const createdQuestionsData: Array<{
      numericId: number;
      subject: string;
      type: string;
      prompt: string;
      options: Array<{ key: string; text: string }>;
      correctAnswer: string;
      points: number;
    }> = [];

    for (let i = 0; i < qDefs.length; i += 1) {
      const q = qDefs[i];
      const numId = nextNumericId() + 100 + i;
      const qDocId = `q_${numId}`;
      createdQIds.push(numId);
      createdQuestionsData.push({
        numericId: numId,
        subject: q.subject,
        type: q.type,
        prompt: q.prompt,
        options: q.options,
        correctAnswer: q.correctAnswer,
        points: q.points,
      });

      batch.set(doc(db, 'questions', qDocId), {
        id: qDocId,
        numericId: numId,
        teacherUid: adminUser.uid,
        teacherName: adminUser.name,
        teacherUsername: adminUser.username,
        subject: q.subject,
        className: 'Semua Kelas',
        targetClasses: [],
        type: q.type,
        prompt: q.prompt,
        imageData: '',
        options: q.options,
        correctAnswer: q.correctAnswer,
        points: q.points,
        difficulty: q.difficulty,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    const examNumId = nextNumericId() + 500;
    const examId = `exam_${examNumId}`;
    const examCode = 'UJIAN2026';
    const proctorPin = '998877';
    const proctorPinHash = await sha256Hex(`${examId}:${proctorPin}`);
    const now = Date.now();

    batch.set(doc(db, 'exams', examId), {
      id: examId,
      numericId: examNumId,
      teacherUid: adminUser.uid,
      teacherName: adminUser.name,
      teacherUsername: adminUser.username,
      title: 'Penilaian Tengah Semester — Informatika & Keamanan Digital',
      subject: 'Informatika & Literasi Digital',
      examCode,
      description:
        'Asesmen digital berbasis CBT dengan pemantauan Exam Mode, autosave berkala, dan sinkronisasi waktu.',
      durationMinutes: 45,
      startTime: Timestamp.fromMillis(now - 24 * 60 * 60 * 1000),
      endTime: Timestamp.fromMillis(now + 30 * 24 * 60 * 60 * 1000),
      questionCount: createdQIds.length,
      kkm: 75,
      shuffleQuestions: false,
      shuffleOptions: false,
      allowStudentViewResult: true,
      isPublished: true,
      requireFullscreen: true,
      detectTabSwitch: true,
      detectWindowBlur: true,
      blockCopyPaste: true,
      maxViolations: 3,
      violationAction: 'suspend',
      proctorPinHash,
      targetClasses: [],
      questionIds: createdQIds,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    batch.set(doc(db, 'examCodes', examCode), {
      examCode,
      examId,
      teacherUid: adminUser.uid,
      isPublished: true,
      updatedAt: serverTimestamp(),
    });

    createdQuestionsData.forEach((qd, idx) => {
      const itemId = `item_${qd.numericId}`;
      batch.set(doc(db, 'exams', examId, 'items', itemId), {
        id: itemId,
        questionNumericId: qd.numericId,
        orderIndex: idx,
        subject: qd.subject,
        type: qd.type,
        prompt: qd.prompt,
        imageData: '',
        options: qd.options,
        points: qd.points,
      });
    });

    batch.set(doc(db, 'exams', examId, 'private', 'config'), {
      docType: 'config',
      examId,
      teacherUid: adminUser.uid,
      proctorPin,
      updatedAt: serverTimestamp(),
    });

    batch.set(doc(db, 'exams', examId, 'private', 'keys'), {
      docType: 'keys',
      examId,
      teacherUid: adminUser.uid,
      allowStudentViewResult: true,
      entries: createdQuestionsData.map((qd) => ({
        questionNumericId: qd.numericId,
        type: qd.type,
        correctAnswer: qd.correctAnswer,
        points: qd.points,
      })),
      updatedAt: serverTimestamp(),
    });

    await batch.commit();
  } catch (err) {
    console.warn('Initial admin seed skipped or failed:', err);
  }
}

const pendingUserSyncs = new Map<string, Promise<AuthUser>>();

export function syncSignedInUser(fbUser: FirebaseUser): Promise<AuthUser> {
  const existing = pendingUserSyncs.get(fbUser.uid);
  if (existing) return existing;

  const task = syncSignedInUserImpl(fbUser).finally(() => {
    pendingUserSyncs.delete(fbUser.uid);
  });
  pendingUserSyncs.set(fbUser.uid, task);
  return task;
}

async function syncSignedInUserImpl(fbUser: FirebaseUser): Promise<AuthUser> {
  const email = (fbUser.email || '').trim().toLowerCase();
  const isInternalAdmin = email === SUPER_ADMIN_INTERNAL_EMAIL;
  const isBootstrapAdmin =
    (email === BOOTSTRAP_ADMIN_EMAIL && fbUser.emailVerified) ||
    isInternalAdmin;

  const userRef = doc(db, 'users', fbUser.uid);
  let snap;
  try {
    snap = await getDoc(userRef);
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, `users/${fbUser.uid}`);
  }

  let resolvedRole: UserRole = 'siswa';
  let resolvedName = isInternalAdmin
    ? 'Super Admin MKC CBT'
    : fbUser.displayName || email.split('@')[0] || 'Pengguna';
  let resolvedUsername = isInternalAdmin
    ? 'webadmin'
    : email
        .split('@')[0]
        .toLowerCase()
        .replace(/[^a-z0-9._-]/g, '')
        .slice(0, 32) || fbUser.uid.slice(0, 12);
  let resolvedClassName = 'Umum';
  let numericId = nextNumericId();

  if (isBootstrapAdmin) {
    resolvedRole = 'super_admin';
    resolvedClassName = 'Administrator Sistem';
    try {
      const adminSnap = await getDoc(doc(db, 'admins', fbUser.uid));
      if (!adminSnap.exists()) {
        await setDoc(doc(db, 'admins', fbUser.uid), {
          uid: fbUser.uid,
          email,
          createdAt: serverTimestamp(),
        });
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `admins/${fbUser.uid}`);
    }
  } else if (email) {
    const invKey = emailToKey(email);
    try {
      const inviteSnap = await getDoc(doc(db, 'teacherInvites', invKey));
      if (inviteSnap.exists()) {
        const inv = inviteSnap.data();
        resolvedRole = 'guru';
        resolvedName = inv.name || resolvedName;
        resolvedUsername = inv.username || resolvedUsername;
        resolvedClassName = inv.className || 'Guru Mata Pelajaran';
      }
    } catch {
      // No invite found or not permitted; treat as student
    }
  }

  if (!snap.exists()) {
    try {
      await setDoc(userRef, {
        uid: fbUser.uid,
        numericId,
        username: resolvedUsername,
        name: resolvedName.slice(0, 120),
        role: resolvedRole,
        className: resolvedClassName.slice(0, 80),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `users/${fbUser.uid}`);
    }
  } else {
    const existing = snap.data();
    numericId = Number(existing.numericId) || numericId;
    if (!isBootstrapAdmin && existing.role) {
      resolvedRole =
        resolvedRole === 'guru' ? 'guru' : (existing.role as UserRole);
    }
    resolvedName = existing.name || resolvedName;
    resolvedUsername = existing.username || resolvedUsername;
    resolvedClassName = existing.className || resolvedClassName;

    if (isBootstrapAdmin && existing.role !== 'super_admin') {
      try {
        await updateDoc(userRef, {
          role: 'super_admin',
          updatedAt: serverTimestamp(),
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, `users/${fbUser.uid}`);
      }
    }
  }

  if (email) {
    const privRef = doc(db, 'users', fbUser.uid, 'private', 'info');
    try {
      const privSnap = await getDoc(privRef);
      if (!privSnap.exists()) {
        await setDoc(privRef, {
          uid: fbUser.uid,
          email,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } else if (privSnap.data().email !== email) {
        await updateDoc(privRef, {
          email,
          updatedAt: serverTimestamp(),
        });
      }
    } catch (err) {
      handleFirestoreError(
        err,
        OperationType.WRITE,
        `users/${fbUser.uid}/private/info`
      );
    }
  }

  const authUser: AuthUser = {
    id: numericId,
    uid: fbUser.uid,
    username: resolvedUsername,
    name: resolvedName,
    email: email.endsWith(`@${INTERNAL_AUTH_DOMAIN}`) ? null : email || null,
    role: resolvedRole,
    className: resolvedClassName,
  };

  if (authUser.role === 'super_admin') {
    await ensureDemoSeededForAdmin(authUser);
  }

  return authUser;
}

export async function loginWithUsernameAndPassword(params: {
  role: UserRole;
  username: string;
  credential: string;
  examCode?: string;
}): Promise<{
  user: AuthUser;
  initialExamLookup: ExamLookupResponse | null;
}> {
  const cleanUsername = sanitizeText(params.username, 64)
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '');
  const rawSecret = String(params.credential ?? '').trim();

  if (!cleanUsername || !rawSecret) {
    throw new Error(
      params.role === 'siswa'
        ? 'Username/NIS dan PIN siswa wajib diisi.'
        : 'Username dan kata sandi wajib diisi.'
    );
  }

  const internalEmail = toInternalAuthEmail(cleanUsername);
  const fbPassword =
    params.role === 'siswa' ? toStudentAuthPassword(rawSecret) : rawSecret;

  let fbUser: FirebaseUser;
  try {
    const cred = await signInWithEmailAndPassword(
      auth,
      internalEmail,
      fbPassword
    );
    fbUser = cred.user;
  } catch (err: any) {
    const code = err?.code || '';
    if (code === 'auth/operation-not-allowed') {
      throw getProviderNotAllowedError();
    }

    if (
      (code === 'auth/user-not-found' || code === 'auth/invalid-credential') &&
      cleanUsername === 'webadmin' &&
      rawSecret === 'webadmin123'
    ) {
      try {
        const created = await createUserWithEmailAndPassword(
          auth,
          SUPER_ADMIN_INTERNAL_EMAIL,
          'webadmin123'
        );
        fbUser = created.user;
      } catch (createErr: any) {
        if (createErr?.code === 'auth/operation-not-allowed') {
          throw getProviderNotAllowedError();
        }
        throw new Error('Username atau kata sandi Super Admin salah.');
      }
    } else if (
      code === 'auth/wrong-password' ||
      code === 'auth/user-not-found' ||
      code === 'auth/invalid-credential'
    ) {
      throw new Error(
        params.role === 'siswa'
          ? 'Username/NIS atau PIN siswa tidak cocok.'
          : params.role === 'super_admin'
          ? 'Username atau kata sandi Super Admin salah.'
          : 'Username atau kata sandi guru salah.'
      );
    } else if (code === 'auth/too-many-requests') {
      throw new Error(
        'Terlalu banyak percobaan login gagal. Tunggu sebentar lalu coba lagi.'
      );
    } else {
      throw new Error(err?.message || 'Gagal melakukan autentikasi.');
    }
  }

  const syncedUser = await syncSignedInUser(fbUser);

  const roleAllowed =
    params.role === 'siswa'
      ? syncedUser.role === 'siswa'
      : params.role === 'super_admin'
      ? syncedUser.role === 'super_admin'
      : syncedUser.role === 'guru' || syncedUser.role === 'super_admin';

  if (!roleAllowed) {
    await signOut(auth).catch(() => undefined);
    throw new Error(
      params.role === 'siswa'
        ? 'Akun ini adalah akun Guru/Admin. Gunakan mode Login Guru / Admin.'
        : params.role === 'super_admin'
        ? 'Username atau kata sandi Super Admin salah.'
        : 'Username atau kata sandi guru salah.'
    );
  }

  let initialExamLookup: ExamLookupResponse | null = null;
  const cleanCode = normalizeExamCode(params.examCode || '');
  if (syncedUser.role === 'siswa' && cleanCode) {
    initialExamLookup = await lookupExamByCodeForStudent(cleanCode, syncedUser);
  }

  return {
    user: syncedUser,
    initialExamLookup,
  };
}

export async function getPublicPortalInfoFromFirestore(): Promise<PublicPortalInfo> {
  try {
    const snap = await getDoc(doc(db, 'portalSettings', 'main'));
    if (snap.exists()) {
      const d = snap.data();
      return {
        schoolName: d.schoolName || 'SDN 09 SADANIANG',
        examTheme: d.examTheme || 'Tes Akhir Semester',
        academicYear: d.academicYear || 'Tahun Pelajaran 2026/2027',
        footerText: d.footerText || '© Fikrul MKC · MKC CBT',
        serverTime: new Date().toISOString(),
        stats: {
          studentCount: Number(d.studentCount) || 0,
          classCount: Number(d.classCount) || 0,
          examCount: Number(d.examCount) || 0,
          completedSessionCount: Number(d.completedSessionCount) || 0,
        },
      };
    }
  } catch (err) {
    console.warn('Fallback portal settings:', err);
  }
  return {
    schoolName: 'SDN 09 SADANIANG',
    examTheme: 'Tes Akhir Semester',
    academicYear: 'Tahun Pelajaran 2026/2027',
    footerText: '© Fikrul MKC · MKC CBT',
    serverTime: new Date().toISOString(),
    stats: {
      studentCount: 0,
      classCount: 0,
      examCount: 0,
      completedSessionCount: 0,
    },
  };
}

async function refreshPortalCountersIfAdmin() {
  if (!isCurrentUserAdminEmail()) return;
  try {
    const [portalSnap, rosterSnap, userStudentsSnap, examsSnap, sessionsSnap] =
      await Promise.all([
        getDoc(doc(db, 'portalSettings', 'main')),
        getDocs(collection(db, 'studentRoster')),
        getDocs(query(collection(db, 'users'), where('role', '==', 'siswa'))),
        getDocs(collection(db, 'exams')),
        getDocs(collection(db, 'examSessions')),
      ]);
    const classSet = new Set<string>();
    const usernames = new Set<string>();
    rosterSnap.docs.forEach((d) => {
      const data = d.data();
      usernames.add(data.username);
      if (data.className) classSet.add(String(data.className).trim());
    });
    userStudentsSnap.docs.forEach((d) => {
      const data = d.data();
      usernames.add(data.username);
      if (data.className) classSet.add(String(data.className).trim());
    });
    const completed = sessionsSnap.docs.filter((d) => {
      const st = d.data().status;
      return st === 'submitted' || st === 'timed_out';
    }).length;

    const existing = portalSnap.exists() ? portalSnap.data() : {};
    await setDoc(doc(db, 'portalSettings', 'main'), {
      schoolName: existing.schoolName || 'SDN 09 SADANIANG',
      examTheme: existing.examTheme || 'Tes Akhir Semester',
      academicYear: existing.academicYear || 'Tahun Pelajaran 2026/2027',
      footerText: existing.footerText || '© Fikrul MKC · MKC CBT',
      studentCount: usernames.size,
      classCount: classSet.size,
      examCount: examsSnap.size,
      completedSessionCount: completed,
      updatedAt: serverTimestamp(),
    });
  } catch {
    // Non-critical counter refresh
  }
}

async function fetchQuestionsForActor(actor: AuthUser) {
  const col = collection(db, 'questions');
  const q =
    actor.role === 'super_admin'
      ? col
      : query(col, where('teacherUid', '==', actor.uid));
  try {
    const snap = await getDocs(q);
    return snap.docs
      .map((d) => {
        const data = d.data();
        const normalizedClasses = normalizeQuestionClasses(
          data.targetClasses,
          data.className
        );
        return {
          docId: d.id,
          id: Number(data.numericId),
          teacherId: 1,
          teacherUid: data.teacherUid,
          teacherName: data.teacherName || 'Guru',
          teacherUsername: data.teacherUsername || '-',
          subject: data.subject,
          className: normalizedClasses.className,
          targetClasses: normalizedClasses.targetClasses,
          type: data.type,
          prompt: data.prompt,
          imageData: data.imageData || null,
          options: Array.isArray(data.options) ? data.options : [],
          correctAnswer: data.correctAnswer,
          points: Number(data.points) || 10,
          difficulty: data.difficulty || 'sedang',
          createdAt: toIso(data.createdAt),
          createdAtMs: toMs(data.createdAt),
        };
      })
      .sort((a, b) => b.createdAtMs - a.createdAtMs);
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'questions');
  }
}

async function fetchExamsForActor(actor: AuthUser) {
  const col = collection(db, 'exams');
  const q =
    actor.role === 'super_admin'
      ? col
      : query(col, where('teacherUid', '==', actor.uid));
  try {
    const [examSnap, sessionSnap] = await Promise.all([
      getDocs(q),
      getDocs(
        actor.role === 'super_admin'
          ? collection(db, 'examSessions')
          : query(
              collection(db, 'examSessions'),
              where('teacherUid', '==', actor.uid)
            )
      ),
    ]);

    const sessionsByExam = new Map<string, any[]>();
    sessionSnap.docs.forEach((sd) => {
      const s = sd.data();
      const list = sessionsByExam.get(s.examId) || [];
      list.push(s);
      sessionsByExam.set(s.examId, list);
    });

    const results = await Promise.all(
      examSnap.docs.map(async (d) => {
        const data = d.data();
        let proctorPin = '123456';
        try {
          const cfgSnap = await getDoc(
            doc(db, 'exams', d.id, 'private', 'config')
          );
          if (cfgSnap.exists()) {
            proctorPin = cfgSnap.data().proctorPin || '123456';
          }
        } catch {
          // ignore
        }
        const examSess = sessionsByExam.get(d.id) || [];
        return {
          docId: d.id,
          id: Number(data.numericId),
          teacherId: 1,
          teacherUid: data.teacherUid,
          teacherName: data.teacherName || 'Guru',
          teacherUsername: data.teacherUsername || '-',
          title: data.title,
          subject: data.subject,
          examCode: data.examCode,
          description: data.description || '',
          durationMinutes: Number(data.durationMinutes) || 60,
          startTime: toIso(data.startTime),
          endTime: toIso(data.endTime),
          questionCount: Number(data.questionCount) || 10,
          kkm: Number(data.kkm) ?? 75,
          shuffleQuestions: Boolean(data.shuffleQuestions),
          shuffleOptions: Boolean(data.shuffleOptions),
          allowStudentViewResult: Boolean(data.allowStudentViewResult),
          isPublished: data.isPublished !== false,
          requireFullscreen: data.requireFullscreen !== false,
          detectTabSwitch: data.detectTabSwitch !== false,
          detectWindowBlur: data.detectWindowBlur !== false,
          blockCopyPaste: data.blockCopyPaste !== false,
          maxViolations: Number(data.maxViolations) || 3,
          violationAction:
            data.violationAction === 'auto_submit' ? 'auto_submit' : 'suspend',
          proctorPin,
          targetClasses: Array.isArray(data.targetClasses)
            ? data.targetClasses
            : [],
          questionIds: Array.isArray(data.questionIds)
            ? data.questionIds.map(Number)
            : [],
          sessionStats: {
            total: examSess.length,
            inProgress: examSess.filter((s) => s.status === 'in_progress').length,
            suspended: examSess.filter((s) => s.status === 'suspended').length,
            completed: examSess.filter(
              (s) => s.status === 'submitted' || s.status === 'timed_out'
            ).length,
          },
          createdAtMs: toMs(data.createdAt),
        };
      })
    );

    return results.sort((a, b) => b.createdAtMs - a.createdAtMs);
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'exams');
  }
}

function gradeObjectiveQuestion(
  type: string,
  correctAnswer: string,
  studentAnswer: string,
  maxPoints: number
): { isCorrect: boolean; autoPoints: number } {
  const cleanStudent = (studentAnswer || '').trim();
  if (!cleanStudent) return { isCorrect: false, autoPoints: 0 };

  if (type === 'pg' || type === 'benar_salah') {
    const ok =
      cleanStudent.toUpperCase() === (correctAnswer || '').trim().toUpperCase();
    return { isCorrect: ok, autoPoints: ok ? maxPoints : 0 };
  }

  if (type === 'isian') {
    const accepted = (correctAnswer || '')
      .split(',')
      .map((a) => a.trim().toLowerCase())
      .filter(Boolean);
    const ok = accepted.includes(cleanStudent.toLowerCase());
    return { isCorrect: ok, autoPoints: ok ? maxPoints : 0 };
  }

  return { isCorrect: false, autoPoints: 0 };
}

async function autoGradeSessionIfNeeded(sessionDoc: any) {
  const sData = sessionDoc.data();
  if (sData.status !== 'submitted' && sData.status !== 'timed_out') {
    return sData;
  }

  // Recompute objective grading if not yet graded
  try {
    const [keysSnap, answersSnap] = await Promise.all([
      getDoc(doc(db, 'exams', sData.examId, 'private', 'keys')),
      getDocs(
        query(
          collection(db, 'examSessions', sessionDoc.id, 'answers'),
          where('teacherUid', '==', sData.teacherUid)
        )
      ),
    ]);
    if (!keysSnap.exists()) return sData;

    const entries: Array<{
      questionNumericId: number;
      type: string;
      correctAnswer: string;
      points: number;
    }> = keysSnap.data().entries || [];
    const entryMap = new Map(entries.map((e) => [Number(e.questionNumericId), e]));

    let totalAuto = 0;
    let totalEssay = 0;
    let hasEssay = false;
    let needsAnswerUpdate = false;

    const batch = writeBatch(db);
    answersSnap.docs.forEach((ad) => {
      const a = ad.data();
      const qEntry = entryMap.get(Number(a.questionId));
      if (!qEntry) return;
      if (qEntry.type === 'uraian') {
        hasEssay = true;
        totalEssay += Number(a.manualPoints) || 0;
      } else {
        const graded = gradeObjectiveQuestion(
          qEntry.type,
          qEntry.correctAnswer,
          a.answerText || '',
          Number(qEntry.points) || 0
        );
        totalAuto += graded.autoPoints;
        if (
          a.autoPoints !== graded.autoPoints ||
          a.isCorrect !== graded.isCorrect
        ) {
          needsAnswerUpdate = true;
          batch.update(ad.ref, {
            autoPoints: graded.autoPoints,
            isCorrect: graded.isCorrect,
            updatedAt: serverTimestamp(),
          });
        }
      }
    });

    const maxPossible = Number(sData.maxPossibleScore) || 100;
    const autoScorePct =
      maxPossible > 0
        ? Math.min(100, Math.round((totalAuto / maxPossible) * 100))
        : 0;
    const essayScorePct =
      maxPossible > 0
        ? Math.min(100, Math.round((totalEssay / maxPossible) * 100))
        : 0;
    const finalScorePct =
      maxPossible > 0
        ? Math.min(
            100,
            Math.round(((totalAuto + totalEssay) / maxPossible) * 100)
          )
        : 0;

    if (
      needsAnswerUpdate ||
      sData.autoScore !== autoScorePct ||
      sData.finalScore !== finalScorePct ||
      (!hasEssay && !sData.essayGraded)
    ) {
      batch.update(sessionDoc.ref, {
        autoScore: autoScorePct,
        essayScore: essayScorePct,
        finalScore: finalScorePct,
        essayGraded: hasEssay ? Boolean(sData.essayGraded) : true,
        lastSavedAt: serverTimestamp(),
      });
      await batch.commit();
      return {
        ...sData,
        autoScore: autoScorePct,
        essayScore: essayScorePct,
        finalScore: finalScorePct,
        essayGraded: hasEssay ? Boolean(sData.essayGraded) : true,
      };
    }
  } catch (err) {
    console.warn('Auto-grade sync skipped:', err);
  }
  return sData;
}

function normalizeQuestionClasses(
  rawTargetClasses: unknown,
  rawClassName: unknown
): { targetClasses: string[]; className: string } {
  const fromArray = Array.isArray(rawTargetClasses)
    ? rawTargetClasses
        .map((c: any) => sanitizeText(c, 60))
        .filter((c: string) => c && c.toLowerCase() !== 'semua kelas')
    : [];
  const fromString =
    fromArray.length === 0 && typeof rawClassName === 'string'
      ? rawClassName
          .split(/[,;]+/)
          .map((c) => sanitizeText(c, 60))
          .filter((c) => c && c.toLowerCase() !== 'semua kelas')
      : [];

  const seen = new Set<string>();
  const targetClasses: string[] = [];
  for (const item of [...fromArray, ...fromString]) {
    const key = item.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      targetClasses.push(item);
      if (targetClasses.length >= 50) break;
    }
  }

  let className = 'Semua Kelas';
  if (targetClasses.length > 0) {
    const joined = targetClasses.join(', ');
    if (joined.length <= 80) {
      className = joined;
    } else {
      let acc = targetClasses[0].slice(0, 60);
      let count = 1;
      for (let i = 1; i < targetClasses.length; i += 1) {
        const candidate = `${acc}, ${targetClasses[i]}`;
        if (candidate.length <= 64) {
          acc = candidate;
          count += 1;
        } else {
          break;
        }
      }
      const remaining = targetClasses.length - count;
      className = remaining > 0 ? `${acc} (+${remaining})` : acc.slice(0, 80);
    }
  }
  return { targetClasses, className };
}

function validateQuestionPayload(body: any) {
  const subject = sanitizeText(body?.subject, 120);
  const { targetClasses, className } = normalizeQuestionClasses(
    body?.targetClasses,
    body?.className
  );
  const type = body?.type;
  const prompt = sanitizeText(body?.prompt, 4000);
  const correctAnswer = sanitizeText(body?.correctAnswer, 2000);
  const points = Math.max(1, Math.min(100, Math.round(Number(body?.points) || 10)));
  const difficulty = ['mudah', 'sedang', 'sulit'].includes(body?.difficulty)
    ? body.difficulty
    : 'sedang';

  if (!subject) throw new Error('Mata pelajaran wajib diisi.');
  if (!['pg', 'isian', 'benar_salah', 'uraian'].includes(type)) {
    throw new Error('Tipe soal tidak valid.');
  }
  if (!prompt) throw new Error('Teks pertanyaan soal wajib diisi.');

  let options: Array<{ key: string; text: string }> = [];
  if (type === 'pg') {
    const rawOpts = Array.isArray(body?.options) ? body.options : [];
    const parsedOpts = rawOpts
      .map((o: any) => ({
        key: sanitizeText(o?.key, 8).toUpperCase(),
        text: sanitizeText(o?.text, 1000),
      }))
      .filter((o: any) => o.key && o.text)
      .slice(0, 10);
    if (parsedOpts.length < 2) {
      throw new Error('Soal Pilihan Ganda minimal memiliki 2 opsi jawaban.');
    }
    if (!parsedOpts.some((o: any) => o.key === correctAnswer.toUpperCase())) {
      throw new Error(
        'Kunci jawaban PG harus sesuai dengan salah satu huruf opsi.'
      );
    }
    options = parsedOpts;
  } else if (type === 'benar_salah') {
    const norm = correctAnswer.toUpperCase();
    if (norm !== 'BENAR' && norm !== 'SALAH') {
      throw new Error('Kunci jawaban Benar-Salah harus BENAR atau SALAH.');
    }
  } else if (!correctAnswer) {
    throw new Error('Kunci jawaban / pedoman penskoran wajib diisi.');
  }

  const rawImage = typeof body?.imageData === 'string' ? body.imageData.trim() : '';
  let imageData = '';
  if (rawImage) {
    if (rawImage.length > 750000) {
      throw new Error('Ukuran gambar terlalu besar untuk Firestore (maks ~550 KB).');
    }
    imageData = rawImage;
  }

  return {
    subject,
    className,
    targetClasses,
    type: type as 'pg' | 'isian' | 'benar_salah' | 'uraian',
    prompt,
    imageData,
    options,
    correctAnswer:
      type === 'pg' || type === 'benar_salah'
        ? correctAnswer.toUpperCase()
        : correctAnswer,
    points,
    difficulty,
  };
}

function validateExamPayload(body: any) {
  const title = sanitizeText(body?.title, 150);
  const subject = sanitizeText(body?.subject, 120);
  const examCode = normalizeExamCode(body?.examCode);
  const description = sanitizeText(body?.description || '', 1000);
  const durationMinutes = Math.max(
    1,
    Math.min(360, Math.round(Number(body?.durationMinutes) || 60))
  );
  const startTime = new Date(body?.startTime);
  const endTime = new Date(body?.endTime);
  const kkm = Math.max(0, Math.min(100, Math.round(Number(body?.kkm) ?? 75)));
  const questionIds: number[] = Array.isArray(body?.questionIds)
    ? body.questionIds
        .map((n: any) => Number(n))
        .filter((n: number) => Number.isInteger(n) && n > 0)
        .slice(0, 200)
    : [];
  const questionCount = Math.max(
    1,
    Math.min(200, Math.round(Number(body?.questionCount) || questionIds.length || 10))
  );
  const maxViolations = Math.max(
    1,
    Math.min(20, Math.round(Number(body?.maxViolations) || 3))
  );
  const violationAction =
    body?.violationAction === 'auto_submit' ? 'auto_submit' : 'suspend';
  const proctorPin = sanitizeText(body?.proctorPin || '123456', 32) || '123456';
  const targetClasses: string[] = Array.isArray(body?.targetClasses)
    ? Array.from(
        new Set(
          body.targetClasses
            .map((c: any) => sanitizeText(c, 60))
            .filter(Boolean)
        )
      ).slice(0, 50) as string[]
    : [];

  if (!title) throw new Error('Judul ujian wajib diisi.');
  if (!subject) throw new Error('Mata pelajaran ujian wajib diisi.');
  if (!examCode || examCode.length < 4) {
    throw new Error('Kode ujian minimal 4 karakter alfanumerik.');
  }
  if (Number.isNaN(startTime.getTime()) || Number.isNaN(endTime.getTime())) {
    throw new Error('Jadwal mulai dan selesai harus valid.');
  }
  if (endTime <= startTime) {
    throw new Error('Waktu selesai ujian harus lebih akhir dari waktu mulai.');
  }
  if (proctorPin.length < 4) {
    throw new Error('PIN verifikasi guru minimal 4 karakter.');
  }

  return {
    title,
    subject,
    examCode,
    description,
    durationMinutes,
    startTime,
    endTime,
    questionCount,
    kkm,
    shuffleQuestions: Boolean(body?.shuffleQuestions),
    shuffleOptions: Boolean(body?.shuffleOptions),
    allowStudentViewResult: Boolean(body?.allowStudentViewResult),
    isPublished: body?.isPublished !== false,
    requireFullscreen: body?.requireFullscreen !== false,
    detectTabSwitch: body?.detectTabSwitch !== false,
    detectWindowBlur: body?.detectWindowBlur !== false,
    blockCopyPaste: body?.blockCopyPaste !== false,
    maxViolations,
    violationAction: violationAction as 'suspend' | 'auto_submit',
    proctorPin,
    targetClasses,
    questionIds,
  };
}

export async function dispatchFirestoreApi<T>(
  url: string,
  options: RequestInit = {}
): Promise<T> {
  const method = (options.method || 'GET').toUpperCase();
  const [pathname, queryStr] = url.split('?');
  const params = new URLSearchParams(queryStr || '');
  const body =
    typeof options.body === 'string' && options.body
      ? JSON.parse(options.body)
      : {};

  // 1. Public portal info
  if (pathname === '/api/public/portal-info' && method === 'GET') {
    const info = await getPublicPortalInfoFromFirestore();
    return info as T;
  }

  const actor = await getCurrentAuthProfile();

  // 2. Super Admin: School settings
  if (pathname === '/api/admin/school-settings') {
    if (method === 'GET') {
      const snap = await getDoc(doc(db, 'portalSettings', 'main')).catch((err) =>
        handleFirestoreError(err, OperationType.GET, 'portalSettings/main')
      );
      const d = snap.exists() ? snap.data() : {};
      return {
        settings: {
          id: 1,
          schoolName: d.schoolName || 'SDN 09 SADANIANG',
          examTheme: d.examTheme || 'Tes Akhir Semester',
          academicYear: d.academicYear || 'Tahun Pelajaran 2026/2027',
          footerText: d.footerText || '© Fikrul MKC · MKC CBT',
          updatedAt: toIso(d.updatedAt),
        },
      } as T;
    }
    if (method === 'PUT') {
      const schoolName = sanitizeText(body?.schoolName, 120);
      const examTheme = sanitizeText(body?.examTheme, 120);
      const academicYear = sanitizeText(body?.academicYear || '', 80);
      const footerText =
        sanitizeText(body?.footerText || '', 120) || '© Fikrul MKC · MKC CBT';
      if (!schoolName || schoolName.length < 2) {
        throw new Error('Nama sekolah wajib diisi (minimal 2 karakter).');
      }
      if (!examTheme || examTheme.length < 2) {
        throw new Error('Tema ujian wajib diisi (minimal 2 karakter).');
      }
      const existingSnap = await getDoc(doc(db, 'portalSettings', 'main'));
      const cur = existingSnap.exists() ? existingSnap.data() : {};
      await setDoc(doc(db, 'portalSettings', 'main'), {
        schoolName,
        examTheme,
        academicYear,
        footerText,
        studentCount: Number(cur.studentCount) || 0,
        classCount: Number(cur.classCount) || 0,
        examCount: Number(cur.examCount) || 0,
        completedSessionCount: Number(cur.completedSessionCount) || 0,
        updatedAt: serverTimestamp(),
      }).catch((err) =>
        handleFirestoreError(err, OperationType.WRITE, 'portalSettings/main')
      );
      await refreshPortalCountersIfAdmin();
      return {
        settings: {
          id: 1,
          schoolName,
          examTheme,
          academicYear,
          footerText,
          updatedAt: new Date().toISOString(),
        },
      } as T;
    }
  }

  // 3. Super Admin: Teachers
  if (pathname === '/api/admin/teachers') {
    if (method === 'GET') {
      try {
        const [usersSnap, invitesSnap, qSnap, eSnap] = await Promise.all([
          getDocs(collection(db, 'users')),
          getDocs(collection(db, 'teacherInvites')),
          getDocs(collection(db, 'questions')),
          getDocs(collection(db, 'exams')),
        ]);

        const qCountByUid = new Map<string, number>();
        qSnap.docs.forEach((d) => {
          const tUid = d.data().teacherUid;
          qCountByUid.set(tUid, (qCountByUid.get(tUid) || 0) + 1);
        });
        const eCountByUid = new Map<string, number>();
        eSnap.docs.forEach((d) => {
          const tUid = d.data().teacherUid;
          eCountByUid.set(tUid, (eCountByUid.get(tUid) || 0) + 1);
        });

        const inviteEmailByUsername = new Map<string, string | null>();
        invitesSnap.docs.forEach((d) => {
          const inv = d.data();
          const rawEmail = String(inv.email || '').trim().toLowerCase();
          const displayEmail =
            rawEmail && !rawEmail.endsWith(`@${INTERNAL_AUTH_DOMAIN}`)
              ? rawEmail
              : null;
          inviteEmailByUsername.set(
            String(inv.username || '').toLowerCase(),
            displayEmail
          );
        });

        const teachersList: any[] = [];
        const seenUsernames = new Set<string>();

        usersSnap.docs
          .filter((d) => d.data().role === 'guru')
          .forEach((d) => {
            const u = d.data();
            const uname = String(u.username || '').toLowerCase();
            seenUsernames.add(uname);
            teachersList.push({
              id: Number(u.numericId),
              username: u.username,
              name: u.name,
              email: inviteEmailByUsername.get(uname) ?? null,
              className: u.className || 'Guru Mata Pelajaran',
              questionCount: qCountByUid.get(u.uid) || 0,
              examCount: eCountByUid.get(u.uid) || 0,
              createdAt: toIso(u.createdAt),
            });
          });

        invitesSnap.docs.forEach((d) => {
          const inv = d.data();
          const uname = String(inv.username || '').toLowerCase();
          if (!seenUsernames.has(uname)) {
            seenUsernames.add(uname);
            const rawEmail = String(inv.email || '').trim().toLowerCase();
            teachersList.push({
              id: Number(inv.numericId),
              username: inv.username,
              name: inv.name,
              email:
                rawEmail && !rawEmail.endsWith(`@${INTERNAL_AUTH_DOMAIN}`)
                  ? rawEmail
                  : null,
              className: inv.className || 'Guru Mata Pelajaran',
              questionCount: 0,
              examCount: 0,
              createdAt: toIso(inv.createdAt),
            });
          }
        });

        return { teachers: teachersList } as T;
      } catch (err) {
        handleFirestoreError(err, OperationType.LIST, 'teacherInvites');
      }
    }

    if (method === 'POST') {
      const username = sanitizeText(body?.username, 40)
        .toLowerCase()
        .replace(/[^a-z0-9._-]/g, '');
      const name = sanitizeText(body?.name, 100);
      const contactEmail = sanitizeText(body?.email || '', 120).toLowerCase();
      const password = String(body?.password ?? '').trim();
      const className =
        sanitizeText(body?.className || '', 80) || 'Guru Mata Pelajaran';

      if (!username || username.length < 3) {
        throw new Error('Username guru minimal 3 karakter.');
      }
      if (!name) {
        throw new Error('Nama lengkap guru wajib diisi.');
      }
      if (!password || password.length < 6) {
        throw new Error('Kata sandi login guru minimal 6 karakter.');
      }
      if (contactEmail && !contactEmail.includes('@')) {
        throw new Error('Format email kontak tidak valid.');
      }

      const internalEmail = toInternalAuthEmail(username);
      const inviteId = emailToKey(internalEmail);

      const existingInvite = await getDoc(doc(db, 'teacherInvites', inviteId));
      if (existingInvite.exists()) {
        throw new Error('Username guru sudah digunakan.');
      }

      const teacherUid = await provisionAuthUserWithoutSigningOut(
        internalEmail,
        password
      );
      if (!teacherUid) {
        throw new Error('Username guru sudah digunakan di sistem.');
      }

      const numId = nextNumericId();
      try {
        const batch = writeBatch(db);
        batch.set(doc(db, 'teacherInvites', inviteId), {
          id: inviteId,
          numericId: numId,
          username,
          name,
          email: contactEmail || internalEmail,
          className,
          createdByUid: actor.uid,
          createdAt: serverTimestamp(),
        });
        batch.set(doc(db, 'users', teacherUid), {
          uid: teacherUid,
          numericId: numId,
          username,
          name,
          role: 'guru',
          className,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        await batch.commit();
      } catch (err) {
        handleFirestoreError(
          err,
          OperationType.CREATE,
          `teacherInvites/${inviteId}`
        );
      }

      return {
        teacher: {
          id: numId,
          username,
          name,
          email: contactEmail || null,
          className,
          questionCount: 0,
          examCount: 0,
          createdAt: new Date().toISOString(),
        },
      } as T;
    }
  }

  if (pathname.startsWith('/api/admin/teachers/') && method === 'DELETE') {
    const numId = Number(pathname.split('/').pop());
    try {
      const [invSnap, usrSnap] = await Promise.all([
        getDocs(
          query(collection(db, 'teacherInvites'), where('numericId', '==', numId))
        ),
        getDocs(query(collection(db, 'users'), where('numericId', '==', numId))),
      ]);
      for (const d of invSnap.docs) {
        await deleteDoc(d.ref);
      }
      for (const d of usrSnap.docs) {
        if (d.data().role === 'guru') {
          await deleteDoc(d.ref);
        }
      }
      return { success: true } as T;
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, 'teacherInvites');
    }
  }

  // 4. Teacher Dashboard
  if (pathname === '/api/teacher/dashboard' && method === 'GET') {
    const [qs, exs, sessSnap, violSnap, rosterSnap] = await Promise.all([
      fetchQuestionsForActor(actor),
      fetchExamsForActor(actor),
      getDocs(
        actor.role === 'super_admin'
          ? collection(db, 'examSessions')
          : query(
              collection(db, 'examSessions'),
              where('teacherUid', '==', actor.uid)
            )
      ).catch((err) =>
        handleFirestoreError(err, OperationType.LIST, 'examSessions')
      ),
      getDocs(
        actor.role === 'super_admin'
          ? collection(db, 'violationLogs')
          : query(
              collection(db, 'violationLogs'),
              where('teacherUid', '==', actor.uid)
            )
      ).catch((err) =>
        handleFirestoreError(err, OperationType.LIST, 'violationLogs')
      ),
      getDocs(
        actor.role === 'super_admin'
          ? collection(db, 'studentRoster')
          : query(
              collection(db, 'studentRoster'),
              where('createdByUid', '==', actor.uid)
            )
      ).catch((err) =>
        handleFirestoreError(err, OperationType.LIST, 'studentRoster')
      ),
    ]);

    const sessions = await Promise.all(
      sessSnap.docs.map((d) => autoGradeSessionIfNeeded(d))
    );
    const completed = sessions.filter(
      (s) => s.status === 'submitted' || s.status === 'timed_out'
    );
    const activeOrSuspended = sessions.filter(
      (s) => s.status === 'in_progress' || s.status === 'suspended'
    ).length;

    const avgScore =
      completed.length > 0
        ? Math.round(
            completed.reduce((sum, s) => sum + (Number(s.finalScore) || 0), 0) /
              completed.length
          )
        : 0;
    const passed = completed.filter(
      (s) => (Number(s.finalScore) || 0) >= (Number(s.kkm) || 75)
    ).length;
    const passRate =
      completed.length > 0 ? Math.round((passed / completed.length) * 100) : 0;

    const recentViolations = violSnap.docs
      .map((d) => {
        const v = d.data();
        return {
          id: Number(v.numericId),
          sessionId: 1,
          examId: 1,
          studentId: 1,
          violationType: v.violationType,
          description: v.description,
          actionTaken: v.actionTaken,
          occurredAt: toIso(v.occurredAt),
          occurredAtMs: toMs(v.occurredAt),
          studentName: v.studentName,
          studentUsername: v.studentUsername,
          studentClass: v.studentClass,
          examTitle: v.examTitle,
          examCode: v.examCode,
        };
      })
      .sort((a, b) => b.occurredAtMs - a.occurredAtMs)
      .slice(0, 10);

    await refreshPortalCountersIfAdmin();

    return {
      stats: {
        totalExams: exs.length,
        totalQuestions: qs.length,
        totalStudents: rosterSnap.size,
        totalSessions: sessions.length,
        activeOrSuspended,
        completedCount: completed.length,
        averageScore: avgScore,
        passRate,
        totalViolations: violSnap.size,
      },
      recentExams: exs.slice(0, 5),
      recentViolations,
    } as T;
  }

  // 5. Students & Classes
  if (pathname === '/api/teacher/students') {
    if (method === 'GET') {
      try {
        const [rosterSnap, userStuSnap] = await Promise.all([
          getDocs(
            actor.role === 'super_admin'
              ? collection(db, 'studentRoster')
              : query(
                  collection(db, 'studentRoster'),
                  where('createdByUid', '==', actor.uid)
                )
          ),
          getDocs(
            query(collection(db, 'users'), where('role', '==', 'siswa'))
          ),
        ]);

        const map = new Map<string, any>();
        rosterSnap.docs.forEach((d) => {
          const r = d.data();
          map.set(r.username, {
            id: Number(r.numericId),
            username: r.username,
            name: r.name,
            email: null,
            className: r.className,
            accessPin: r.accessPin,
            createdAt: toIso(r.createdAt),
            createdAtMs: toMs(r.createdAt),
          });
        });

        userStuSnap.docs.forEach((d) => {
          const u = d.data();
          if (!map.has(u.username)) {
            map.set(u.username, {
              id: Number(u.numericId),
              username: u.username,
              name: u.name,
              email: null,
              className: u.className || 'Umum',
              accessPin: null,
              createdAt: toIso(u.createdAt),
              createdAtMs: toMs(u.createdAt),
            });
          }
        });

        const students = Array.from(map.values()).sort(
          (a, b) => b.createdAtMs - a.createdAtMs
        );
        return { students } as T;
      } catch (err) {
        handleFirestoreError(err, OperationType.LIST, 'studentRoster');
      }
    }

    if (method === 'POST') {
      const username = sanitizeText(body?.username, 40)
        .toLowerCase()
        .replace(/[^a-z0-9._-]/g, '');
      const name = sanitizeText(body?.name, 100);
      const className = sanitizeText(body?.className, 60) || 'Umum';
      const pin = sanitizeText(body?.pin, 32);

      if (!username || username.length < 3) {
        throw new Error('Username/NIS minimal 3 karakter.');
      }
      if (!name) throw new Error('Nama lengkap siswa wajib diisi.');
      if (!pin || pin.length < 4) {
        throw new Error('PIN siswa minimal 4 karakter.');
      }

      const [dupRosterSnap, dupUserSnap] = await Promise.all([
        getDocs(
          actor.role === 'super_admin'
            ? query(collection(db, 'studentRoster'), where('username', '==', username))
            : query(
                collection(db, 'studentRoster'),
                where('createdByUid', '==', actor.uid),
                where('username', '==', username)
              )
        ),
        getDocs(
          query(
            collection(db, 'users'),
            where('role', '==', 'siswa'),
            where('username', '==', username)
          )
        ),
      ]);

      if (!dupRosterSnap.empty || !dupUserSnap.empty) {
        throw new Error('Username/NIS sudah terdaftar.');
      }

      const studentUid = await provisionAuthUserWithoutSigningOut(
        toInternalAuthEmail(username),
        toStudentAuthPassword(pin)
      );
      if (!studentUid) {
        throw new Error('Username/NIS sudah digunakan oleh akun lain.');
      }

      const numId = nextNumericId();
      const rosterId = `roster_${numId}`;
      try {
        const batch = writeBatch(db);
        batch.set(doc(db, 'studentRoster', rosterId), {
          id: rosterId,
          numericId: numId,
          username,
          name,
          className,
          accessPin: pin,
          createdByUid: actor.uid,
          createdAt: serverTimestamp(),
        });
        batch.set(doc(db, 'users', studentUid), {
          uid: studentUid,
          numericId: numId,
          username,
          name,
          role: 'siswa',
          className,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        await batch.commit();
      } catch (err) {
        handleFirestoreError(
          err,
          OperationType.CREATE,
          `studentRoster/${rosterId}`
        );
      }
      await refreshPortalCountersIfAdmin();

      return {
        student: {
          id: numId,
          username,
          name,
          email: null,
          className,
          accessPin: pin,
          createdAt: new Date().toISOString(),
        },
      } as T;
    }
  }

  if (pathname === '/api/teacher/students/import' && method === 'POST') {
    const rawList = Array.isArray(body?.students) ? body.students : [];
    if (rawList.length === 0) {
      throw new Error('Daftar akun siswa untuk diimpor tidak boleh kosong.');
    }
    const [existingRosterSnap, existingStudentUsersSnap] = await Promise.all([
      getDocs(
        actor.role === 'super_admin'
          ? collection(db, 'studentRoster')
          : query(
              collection(db, 'studentRoster'),
              where('createdByUid', '==', actor.uid)
            )
      ),
      getDocs(query(collection(db, 'users'), where('role', '==', 'siswa'))),
    ]);
    const existingUsernames = new Set<string>();
    existingRosterSnap.docs.forEach((d) =>
      existingUsernames.add(String(d.data().username || '').toLowerCase())
    );
    existingStudentUsersSnap.docs.forEach((d) =>
      existingUsernames.add(String(d.data().username || '').toLowerCase())
    );

    const skippedUsernames: string[] = [];
    const candidates: Array<{
      username: string;
      name: string;
      className: string;
      pin: string;
      numId: number;
    }> = [];

    rawList.slice(0, 400).forEach((item: any, idx: number) => {
      const username = sanitizeText(item?.username, 40)
        .toLowerCase()
        .replace(/[^a-z0-9._-]/g, '');
      const name = sanitizeText(item?.name, 100);
      const className = sanitizeText(item?.className || 'Umum', 60) || 'Umum';
      const pin = sanitizeText(item?.pin, 32);

      if (!username || username.length < 3 || !name || !pin || pin.length < 4) {
        return;
      }
      if (existingUsernames.has(username)) {
        skippedUsernames.push(username);
        return;
      }
      existingUsernames.add(username);
      candidates.push({
        username,
        name,
        className,
        pin,
        numId: nextNumericId() + idx,
      });
    });

    const provisioned: Array<{
      username: string;
      name: string;
      className: string;
      pin: string;
      numId: number;
      uid: string;
    }> = [];

    for (let i = 0; i < candidates.length; i += 5) {
      const slice = candidates.slice(i, i + 5);
      const uids = await Promise.all(
        slice.map((c) =>
          provisionAuthUserWithoutSigningOut(
            toInternalAuthEmail(c.username),
            toStudentAuthPassword(c.pin)
          )
        )
      );
      slice.forEach((c, idx) => {
        const uid = uids[idx];
        if (!uid) {
          skippedUsernames.push(c.username);
        } else {
          provisioned.push({ ...c, uid });
        }
      });
    }

    for (let i = 0; i < provisioned.length; i += 200) {
      const chunk = provisioned.slice(i, i + 200);
      const batch = writeBatch(db);
      chunk.forEach((s) => {
        const rosterId = `roster_${s.numId}`;
        batch.set(doc(db, 'studentRoster', rosterId), {
          id: rosterId,
          numericId: s.numId,
          username: s.username,
          name: s.name,
          className: s.className,
          accessPin: s.pin,
          createdByUid: actor.uid,
          createdAt: serverTimestamp(),
        });
        batch.set(doc(db, 'users', s.uid), {
          uid: s.uid,
          numericId: s.numId,
          username: s.username,
          name: s.name,
          role: 'siswa',
          className: s.className,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      });
      await batch
        .commit()
        .catch((err) =>
          handleFirestoreError(err, OperationType.WRITE, 'studentRoster')
        );
    }

    if (provisioned.length > 0) {
      await refreshPortalCountersIfAdmin();
    }
    return { importedCount: provisioned.length, skippedUsernames } as T;
  }

  if (pathname.startsWith('/api/teacher/students/') && method === 'DELETE') {
    const numId = Number(pathname.split('/').pop());
    try {
      const snap = await getDocs(
        actor.role === 'super_admin'
          ? query(collection(db, 'studentRoster'), where('numericId', '==', numId))
          : query(
              collection(db, 'studentRoster'),
              where('createdByUid', '==', actor.uid),
              where('numericId', '==', numId)
            )
      );
      for (const d of snap.docs) {
        await deleteDoc(d.ref);
      }
      if (actor.role === 'super_admin') {
        const usrSnap = await getDocs(
          query(
            collection(db, 'users'),
            where('role', '==', 'siswa'),
            where('numericId', '==', numId)
          )
        );
        for (const d of usrSnap.docs) {
          await deleteDoc(d.ref);
        }
      }
      await refreshPortalCountersIfAdmin();
      return { success: true } as T;
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, 'studentRoster');
    }
  }

  if (pathname === '/api/teacher/classes' && method === 'GET') {
    try {
      const [rosterSnap, userStuSnap] = await Promise.all([
        getDocs(
          actor.role === 'super_admin'
            ? collection(db, 'studentRoster')
            : query(
                collection(db, 'studentRoster'),
                where('createdByUid', '==', actor.uid)
              )
        ),
        getDocs(query(collection(db, 'users'), where('role', '==', 'siswa'))),
      ]);
      const set = new Set<string>();
      rosterSnap.docs.forEach((d) => {
        const c = String(d.data().className || '').trim();
        if (c) set.add(c);
      });
      userStuSnap.docs.forEach((d) => {
        const c = String(d.data().className || '').trim();
        if (c) set.add(c);
      });
      return {
        classes: Array.from(set).sort((a, b) => a.localeCompare(b, 'id')),
      } as T;
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, 'studentRoster');
    }
  }

  // 6. Question Bank
  if (pathname === '/api/teacher/questions') {
    if (method === 'GET') {
      const items = await fetchQuestionsForActor(actor);
      return { questions: items } as T;
    }
    if (method === 'POST') {
      const payload = validateQuestionPayload(body);
      const numId = nextNumericId();
      const qId = `q_${numId}`;
      try {
        await setDoc(doc(db, 'questions', qId), {
          id: qId,
          numericId: numId,
          teacherUid: actor.uid,
          teacherName: actor.name,
          teacherUsername: actor.username,
          subject: payload.subject,
          className: payload.className,
          targetClasses: payload.targetClasses,
          type: payload.type,
          prompt: payload.prompt,
          imageData: payload.imageData,
          options: payload.options,
          correctAnswer: payload.correctAnswer,
          points: payload.points,
          difficulty: payload.difficulty,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, `questions/${qId}`);
      }
      return {
        question: {
          id: numId,
          ...payload,
          imageData: payload.imageData || null,
          teacherName: actor.name,
          teacherUsername: actor.username,
          createdAt: new Date().toISOString(),
        },
      } as T;
    }
  }

  if (pathname === '/api/teacher/questions/import' && method === 'POST') {
    const rawItems = Array.isArray(body?.questions) ? body.questions : [];
    if (rawItems.length === 0) {
      throw new Error('Daftar soal untuk diimpor tidak boleh kosong.');
    }
    const validated = rawItems
      .slice(0, 200)
      .map((item: any) => validateQuestionPayload(item));
    const batch = writeBatch(db);
    const created: any[] = [];
    validated.forEach((payload: any, idx: number) => {
      const numId = nextNumericId() + idx;
      const qId = `q_${numId}`;
      batch.set(doc(db, 'questions', qId), {
        id: qId,
        numericId: numId,
        teacherUid: actor.uid,
        teacherName: actor.name,
        teacherUsername: actor.username,
        subject: payload.subject,
        className: payload.className,
        targetClasses: payload.targetClasses,
        type: payload.type,
        prompt: payload.prompt,
        imageData: payload.imageData,
        options: payload.options,
        correctAnswer: payload.correctAnswer,
        points: payload.points,
        difficulty: payload.difficulty,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      created.push({
        id: numId,
        ...payload,
        imageData: payload.imageData || null,
        createdAt: new Date().toISOString(),
      });
    });
    await batch
      .commit()
      .catch((err) =>
        handleFirestoreError(err, OperationType.WRITE, 'questions')
      );
    return { importedCount: created.length, questions: created } as T;
  }

  if (pathname.startsWith('/api/teacher/questions/')) {
    const numId = Number(pathname.split('/').pop());
    const qId = `q_${numId}`;
    if (method === 'PUT') {
      const payload = validateQuestionPayload(body);
      try {
        await updateDoc(doc(db, 'questions', qId), {
          subject: payload.subject,
          className: payload.className,
          targetClasses: payload.targetClasses,
          type: payload.type,
          prompt: payload.prompt,
          imageData: payload.imageData,
          options: payload.options,
          correctAnswer: payload.correctAnswer,
          points: payload.points,
          difficulty: payload.difficulty,
          updatedAt: serverTimestamp(),
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, `questions/${qId}`);
      }
      return {
        question: {
          id: numId,
          ...payload,
          imageData: payload.imageData || null,
          createdAt: new Date().toISOString(),
        },
      } as T;
    }
    if (method === 'DELETE') {
      try {
        await deleteDoc(doc(db, 'questions', qId));
        return { success: true } as T;
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, `questions/${qId}`);
      }
    }
  }

  // 7. Exams
  if (pathname === '/api/teacher/exams') {
    if (method === 'GET') {
      const items = await fetchExamsForActor(actor);
      return { exams: items } as T;
    }
    if (method === 'POST') {
      const payload = validateExamPayload(body);
      const existingCodeSnap = await getDoc(
        doc(db, 'examCodes', payload.examCode)
      );
      if (existingCodeSnap.exists()) {
        throw new Error('Kode ujian sudah digunakan. Gunakan kode unik lain.');
      }

      const numId = nextNumericId();
      const examId = `exam_${numId}`;
      const proctorPinHash = await sha256Hex(`${examId}:${payload.proctorPin}`);

      const allQs = await fetchQuestionsForActor(actor);
      const qMap = new Map(allQs.map((q) => [q.id, q]));
      const chosenQs = payload.questionIds
        .map((qid) => qMap.get(qid))
        .filter((q): q is NonNullable<typeof q> => Boolean(q));

      const batch = writeBatch(db);
      batch.set(doc(db, 'exams', examId), {
        id: examId,
        numericId: numId,
        teacherUid: actor.uid,
        teacherName: actor.name,
        teacherUsername: actor.username,
        title: payload.title,
        subject: payload.subject,
        examCode: payload.examCode,
        description: payload.description,
        durationMinutes: payload.durationMinutes,
        startTime: Timestamp.fromDate(payload.startTime),
        endTime: Timestamp.fromDate(payload.endTime),
        questionCount: payload.questionCount,
        kkm: payload.kkm,
        shuffleQuestions: payload.shuffleQuestions,
        shuffleOptions: payload.shuffleOptions,
        allowStudentViewResult: payload.allowStudentViewResult,
        isPublished: payload.isPublished,
        requireFullscreen: payload.requireFullscreen,
        detectTabSwitch: payload.detectTabSwitch,
        detectWindowBlur: payload.detectWindowBlur,
        blockCopyPaste: payload.blockCopyPaste,
        maxViolations: payload.maxViolations,
        violationAction: payload.violationAction,
        proctorPinHash,
        targetClasses: payload.targetClasses,
        questionIds: payload.questionIds,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      batch.set(doc(db, 'examCodes', payload.examCode), {
        examCode: payload.examCode,
        examId,
        teacherUid: actor.uid,
        isPublished: payload.isPublished,
        updatedAt: serverTimestamp(),
      });

      chosenQs.forEach((q, idx) => {
        const itemId = `item_${q.id}`;
        batch.set(doc(db, 'exams', examId, 'items', itemId), {
          id: itemId,
          questionNumericId: q.id,
          orderIndex: idx,
          subject: q.subject,
          type: q.type,
          prompt: q.prompt,
          imageData: q.imageData || '',
          options: q.options || [],
          points: q.points,
        });
      });

      batch.set(doc(db, 'exams', examId, 'private', 'config'), {
        docType: 'config',
        examId,
        teacherUid: actor.uid,
        proctorPin: payload.proctorPin,
        updatedAt: serverTimestamp(),
      });

      batch.set(doc(db, 'exams', examId, 'private', 'keys'), {
        docType: 'keys',
        examId,
        teacherUid: actor.uid,
        allowStudentViewResult: payload.allowStudentViewResult,
        entries: chosenQs.map((q) => ({
          questionNumericId: q.id,
          type: q.type,
          correctAnswer: q.correctAnswer,
          points: q.points,
        })),
        updatedAt: serverTimestamp(),
      });

      await batch
        .commit()
        .catch((err) =>
          handleFirestoreError(err, OperationType.CREATE, `exams/${examId}`)
        );
      await refreshPortalCountersIfAdmin();

      return {
        exam: {
          id: numId,
          ...payload,
          startTime: payload.startTime.toISOString(),
          endTime: payload.endTime.toISOString(),
        },
      } as T;
    }
  }

  if (pathname.startsWith('/api/teacher/exams/')) {
    const numId = Number(pathname.split('/').pop());
    const examId = `exam_${numId}`;

    if (method === 'PUT') {
      const payload = validateExamPayload(body);
      const examRef = doc(db, 'exams', examId);
      const examSnap = await getDoc(examRef).catch((err) =>
        handleFirestoreError(err, OperationType.GET, `exams/${examId}`)
      );
      if (!examSnap.exists()) {
        throw new Error('Ujian tidak ditemukan.');
      }
      const prevExam = examSnap.data();

      if (prevExam.examCode !== payload.examCode) {
        const conflict = await getDoc(doc(db, 'examCodes', payload.examCode));
        if (conflict.exists() && conflict.data().examId !== examId) {
          throw new Error('Kode ujian sudah digunakan oleh ujian lain.');
        }
      }

      const proctorPinHash = await sha256Hex(`${examId}:${payload.proctorPin}`);
      const allQs = await fetchQuestionsForActor(actor);
      const qMap = new Map(allQs.map((q) => [q.id, q]));
      const chosenQs = payload.questionIds
        .map((qid) => qMap.get(qid))
        .filter((q): q is NonNullable<typeof q> => Boolean(q));

      const batch = writeBatch(db);
      batch.update(examRef, {
        title: payload.title,
        subject: payload.subject,
        examCode: payload.examCode,
        description: payload.description,
        durationMinutes: payload.durationMinutes,
        startTime: Timestamp.fromDate(payload.startTime),
        endTime: Timestamp.fromDate(payload.endTime),
        questionCount: payload.questionCount,
        kkm: payload.kkm,
        shuffleQuestions: payload.shuffleQuestions,
        shuffleOptions: payload.shuffleOptions,
        allowStudentViewResult: payload.allowStudentViewResult,
        isPublished: payload.isPublished,
        requireFullscreen: payload.requireFullscreen,
        detectTabSwitch: payload.detectTabSwitch,
        detectWindowBlur: payload.detectWindowBlur,
        blockCopyPaste: payload.blockCopyPaste,
        maxViolations: payload.maxViolations,
        violationAction: payload.violationAction,
        proctorPinHash,
        targetClasses: payload.targetClasses,
        questionIds: payload.questionIds,
        updatedAt: serverTimestamp(),
      });

      if (prevExam.examCode !== payload.examCode) {
        batch.delete(doc(db, 'examCodes', prevExam.examCode));
      }
      batch.set(doc(db, 'examCodes', payload.examCode), {
        examCode: payload.examCode,
        examId,
        teacherUid: actor.uid,
        isPublished: payload.isPublished,
        updatedAt: serverTimestamp(),
      });

      const oldIds: number[] = Array.isArray(prevExam.questionIds)
        ? prevExam.questionIds.map(Number)
        : [];
      const newIdSet = new Set(chosenQs.map((q) => q.id));
      oldIds.forEach((oldQId) => {
        if (!newIdSet.has(oldQId)) {
          batch.delete(doc(db, 'exams', examId, 'items', `item_${oldQId}`));
        }
      });

      chosenQs.forEach((q, idx) => {
        const itemId = `item_${q.id}`;
        batch.set(doc(db, 'exams', examId, 'items', itemId), {
          id: itemId,
          questionNumericId: q.id,
          orderIndex: idx,
          subject: q.subject,
          type: q.type,
          prompt: q.prompt,
          imageData: q.imageData || '',
          options: q.options || [],
          points: q.points,
        });
      });

      batch.set(doc(db, 'exams', examId, 'private', 'config'), {
        docType: 'config',
        examId,
        teacherUid: prevExam.teacherUid,
        proctorPin: payload.proctorPin,
        updatedAt: serverTimestamp(),
      });

      batch.set(doc(db, 'exams', examId, 'private', 'keys'), {
        docType: 'keys',
        examId,
        teacherUid: prevExam.teacherUid,
        allowStudentViewResult: payload.allowStudentViewResult,
        entries: chosenQs.map((q) => ({
          questionNumericId: q.id,
          type: q.type,
          correctAnswer: q.correctAnswer,
          points: q.points,
        })),
        updatedAt: serverTimestamp(),
      });

      await batch
        .commit()
        .catch((err) =>
          handleFirestoreError(err, OperationType.UPDATE, `exams/${examId}`)
        );

      return {
        exam: {
          id: numId,
          ...payload,
          startTime: payload.startTime.toISOString(),
          endTime: payload.endTime.toISOString(),
        },
      } as T;
    }

    if (method === 'DELETE') {
      try {
        const examSnap = await getDoc(doc(db, 'exams', examId));
        const batch = writeBatch(db);
        if (examSnap.exists()) {
          const d = examSnap.data();
          if (d.examCode) {
            batch.delete(doc(db, 'examCodes', d.examCode));
          }
          batch.delete(doc(db, 'exams', examId, 'private', 'config'));
          batch.delete(doc(db, 'exams', examId, 'private', 'keys'));
          const qIds: number[] = Array.isArray(d.questionIds)
            ? d.questionIds.map(Number)
            : [];
          qIds.forEach((qid) => {
            batch.delete(doc(db, 'exams', examId, 'items', `item_${qid}`));
          });
        }
        batch.delete(doc(db, 'exams', examId));
        await batch.commit();
        await refreshPortalCountersIfAdmin();
        return { success: true } as T;
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, `exams/${examId}`);
      }
    }
  }

  // 8. Teacher Results & Grading
  if (pathname === '/api/teacher/results' && method === 'GET') {
    const filterExamId = params.get('examId')
      ? Number(params.get('examId'))
      : undefined;
    const exs = await fetchExamsForActor(actor);

    const sessSnap = await getDocs(
      actor.role === 'super_admin'
        ? collection(db, 'examSessions')
        : query(
            collection(db, 'examSessions'),
            where('teacherUid', '==', actor.uid)
          )
    ).catch((err) =>
      handleFirestoreError(err, OperationType.LIST, 'examSessions')
    );

    const gradedList = await Promise.all(
      sessSnap.docs.map((d) => autoGradeSessionIfNeeded(d))
    );

    const rows = gradedList
      .filter((s) => !filterExamId || Number(s.examNumericId) === filterExamId)
      .map((s) => {
        const startMs = toMs(s.startedAt);
        const endMs = Number(s.submittedAtMs) || Date.now();
        return {
          id: Number(s.numericId),
          examId: Number(s.examNumericId),
          studentId: 1,
          status: s.status,
          startedAt: toIso(s.startedAt),
          serverEndTime: toIso(s.serverEndTime),
          submittedAt: s.submittedAtMs ? new Date(s.submittedAtMs).toISOString() : null,
          violationCount: Number(s.violationCount) || 0,
          autoScore: Number(s.autoScore) || 0,
          essayScore: Number(s.essayScore) || 0,
          maxPossibleScore: Number(s.maxPossibleScore) || 100,
          finalScore: Number(s.finalScore) || 0,
          essayGraded: Boolean(s.essayGraded),
          teacherNotes: s.teacherNotes || '',
          durationSeconds: Math.max(0, Math.floor((endMs - startMs) / 1000)),
          studentName: s.studentName,
          studentUsername: s.studentUsername,
          studentClass: s.studentClass || '-',
          examTitle: s.examTitle,
          examCode: s.examCode,
          kkm: Number(s.kkm) || 75,
          passedKkm: (Number(s.finalScore) || 0) >= (Number(s.kkm) || 75),
          startedAtMs: startMs,
        };
      })
      .sort((a, b) => b.startedAtMs - a.startedAtMs);

    return { exams: exs, sessions: rows } as T;
  }

  if (pathname.startsWith('/api/teacher/results/')) {
    const parts = pathname.split('/');
    const sessionNumId = Number(parts[4]);
    const subAction = parts[5]; // 'grade' | 'unlock' | undefined

    const sessSnap = await getDocs(
      actor.role === 'super_admin'
        ? query(
            collection(db, 'examSessions'),
            where('numericId', '==', sessionNumId)
          )
        : query(
            collection(db, 'examSessions'),
            where('teacherUid', '==', actor.uid),
            where('numericId', '==', sessionNumId)
          )
    ).catch((err) =>
      handleFirestoreError(err, OperationType.LIST, 'examSessions')
    );

    if (sessSnap.empty) {
      throw new Error('Sesi ujian tidak ditemukan.');
    }
    const sessionDoc = sessSnap.docs[0];
    const sData = await autoGradeSessionIfNeeded(sessionDoc);

    if (method === 'GET' && !subAction) {
      const [examSnap, keysSnap, ansSnap, violSnap] = await Promise.all([
        getDoc(doc(db, 'exams', sData.examId)),
        getDoc(doc(db, 'exams', sData.examId, 'private', 'keys')),
        getDocs(
          actor.role === 'super_admin'
            ? collection(db, 'examSessions', sessionDoc.id, 'answers')
            : query(
                collection(db, 'examSessions', sessionDoc.id, 'answers'),
                where('teacherUid', '==', actor.uid)
              )
        ),
        getDocs(
          actor.role === 'super_admin'
            ? query(
                collection(db, 'violationLogs'),
                where('sessionId', '==', sessionDoc.id)
              )
            : query(
                collection(db, 'violationLogs'),
                where('teacherUid', '==', actor.uid),
                where('sessionId', '==', sessionDoc.id)
              )
        ),
      ]);

      const keyEntries: any[] = keysSnap.exists()
        ? keysSnap.data().entries || []
        : [];
      const keyMap = new Map(
        keyEntries.map((e) => [Number(e.questionNumericId), e])
      );
      const ansMap = new Map(
        ansSnap.docs.map((ad) => [Number(ad.data().questionId), ad.data()])
      );

      const qOrder: number[] = Array.isArray(sData.questionOrder)
        ? sData.questionOrder.map(Number)
        : [];
      const items = await Promise.all(
        qOrder.map(async (qNumId) => {
          const itemSnap = await getDoc(
            doc(db, 'exams', sData.examId, 'items', `item_${qNumId}`)
          );
          const it = itemSnap.exists() ? itemSnap.data() : {};
          const k = keyMap.get(qNumId) || {};
          const a = ansMap.get(qNumId) || {};
          return {
            questionId: qNumId,
            type: it.type || k.type || 'pg',
            prompt: it.prompt || '',
            imageData: it.imageData || null,
            options: Array.isArray(it.options) ? it.options : [],
            correctAnswer: k.correctAnswer || '',
            maxPoints: Number(it.points || k.points || 10),
            studentAnswer: a.answerText || '',
            isFlagged: Boolean(a.isFlagged),
            autoPoints: Number(a.autoPoints) || 0,
            manualPoints: Number(a.manualPoints) || 0,
            isCorrect: Boolean(a.isCorrect),
          };
        })
      );

      return {
        session: {
          ...sData,
          id: Number(sData.numericId),
          startedAt: toIso(sData.startedAt),
          serverEndTime: toIso(sData.serverEndTime),
        },
        exam: examSnap.exists()
          ? { ...examSnap.data(), id: Number(examSnap.data().numericId) }
          : { id: Number(sData.examNumericId), title: sData.examTitle },
        student: {
          id: 1,
          name: sData.studentName,
          username: sData.studentUsername,
          className: sData.studentClass,
        },
        items,
        violations: violSnap.docs.map((vd) => ({
          ...vd.data(),
          id: Number(vd.data().numericId),
          occurredAt: toIso(vd.data().occurredAt),
        })),
      } as T;
    }

    if (method === 'POST' && subAction === 'grade') {
      const grades: Array<{ questionId: number; manualPoints: number }> =
        Array.isArray(body?.grades) ? body.grades : [];
      const teacherNotes = sanitizeText(body?.teacherNotes || '', 1000);
      const ansSnap = await getDocs(
        actor.role === 'super_admin'
          ? collection(db, 'examSessions', sessionDoc.id, 'answers')
          : query(
              collection(db, 'examSessions', sessionDoc.id, 'answers'),
              where('teacherUid', '==', actor.uid)
            )
      );
      const keysSnap = await getDoc(
        doc(db, 'exams', sData.examId, 'private', 'keys')
      );
      const keyEntries: any[] = keysSnap.exists()
        ? keysSnap.data().entries || []
        : [];
      const keyMap = new Map(
        keyEntries.map((e) => [Number(e.questionNumericId), e])
      );
      const gradeMap = new Map(
        grades.map((g) => [Number(g.questionId), Math.max(0, Number(g.manualPoints) || 0)])
      );

      const batch = writeBatch(db);
      let totalAuto = 0;
      let totalEssay = 0;

      ansSnap.docs.forEach((ad) => {
        const a = ad.data();
        const qId = Number(a.questionId);
        const k = keyMap.get(qId);
        if (k?.type === 'uraian') {
          const maxPts = Number(k.points) || 100;
          const pts = Math.min(maxPts, gradeMap.get(qId) ?? (Number(a.manualPoints) || 0));
          totalEssay += pts;
          batch.update(ad.ref, {
            manualPoints: pts,
            isCorrect: pts > 0,
            updatedAt: serverTimestamp(),
          });
        } else {
          totalAuto += Number(a.autoPoints) || 0;
        }
      });

      const maxPossible = Number(sData.maxPossibleScore) || 100;
      const autoScorePct =
        maxPossible > 0
          ? Math.min(100, Math.round((totalAuto / maxPossible) * 100))
          : 0;
      const essayScorePct =
        maxPossible > 0
          ? Math.min(100, Math.round((totalEssay / maxPossible) * 100))
          : 0;
      const finalScorePct =
        maxPossible > 0
          ? Math.min(
              100,
              Math.round(((totalAuto + totalEssay) / maxPossible) * 100)
            )
          : 0;

      batch.update(sessionDoc.ref, {
        autoScore: autoScorePct,
        essayScore: essayScorePct,
        finalScore: finalScorePct,
        essayGraded: true,
        teacherNotes,
        lastSavedAt: serverTimestamp(),
      });
      await batch
        .commit()
        .catch((err) =>
          handleFirestoreError(
            err,
            OperationType.UPDATE,
            `examSessions/${sessionDoc.id}`
          )
        );
      return { session: { id: sessionNumId, finalScore: finalScorePct } } as T;
    }

    if (method === 'POST' && subAction === 'unlock') {
      const logNumId = nextNumericId();
      const logId = `log_${logNumId}`;
      const batch = writeBatch(db);
      batch.update(sessionDoc.ref, {
        status: 'in_progress',
        lastSavedAt: serverTimestamp(),
      });
      batch.set(doc(db, 'violationLogs', logId), {
        id: logId,
        numericId: logNumId,
        sessionId: sessionDoc.id,
        examId: sData.examId,
        examTitle: sData.examTitle,
        examCode: sData.examCode,
        teacherUid: sData.teacherUid,
        studentUid: sData.studentUid,
        studentName: sData.studentName,
        studentUsername: sData.studentUsername,
        studentClass: sData.studentClass || '-',
        violationType: 'proctor_unlock',
        description: 'Penangguhan ujian dibuka langsung oleh guru dari panel hasil.',
        actionTaken: 'unlocked_by_teacher',
        occurredAt: serverTimestamp(),
      });
      await batch
        .commit()
        .catch((err) =>
          handleFirestoreError(
            err,
            OperationType.UPDATE,
            `examSessions/${sessionDoc.id}`
          )
        );
      return { session: { id: sessionNumId, status: 'in_progress' } } as T;
    }

    if (method === 'DELETE' && !subAction) {
      try {
        const ansSnap = await getDocs(
          actor.role === 'super_admin'
            ? collection(db, 'examSessions', sessionDoc.id, 'answers')
            : query(
                collection(db, 'examSessions', sessionDoc.id, 'answers'),
                where('teacherUid', '==', actor.uid)
              )
        );
        const batch = writeBatch(db);
        ansSnap.docs.forEach((ad) => batch.delete(ad.ref));
        batch.delete(sessionDoc.ref);
        await batch.commit();
        await refreshPortalCountersIfAdmin();
        return { success: true } as T;
      } catch (err) {
        handleFirestoreError(
          err,
          OperationType.DELETE,
          `examSessions/${sessionDoc.id}`
        );
      }
    }
  }

  // 9. Violations Audit Log
  if (pathname === '/api/teacher/violations' && method === 'GET') {
    const filterExamId = params.get('examId')
      ? Number(params.get('examId'))
      : undefined;
    const [exs, violSnap] = await Promise.all([
      fetchExamsForActor(actor),
      getDocs(
        actor.role === 'super_admin'
          ? collection(db, 'violationLogs')
          : query(
              collection(db, 'violationLogs'),
              where('teacherUid', '==', actor.uid)
            )
      ).catch((err) =>
        handleFirestoreError(err, OperationType.LIST, 'violationLogs')
      ),
    ]);

    const examIdFilterStr = filterExamId ? `exam_${filterExamId}` : null;
    const logs = violSnap.docs
      .map((d) => {
        const v = d.data();
        return {
          id: Number(v.numericId),
          sessionId: 1,
          examId: 1,
          examIdStr: v.examId,
          studentId: 1,
          violationType: v.violationType,
          description: v.description,
          actionTaken: v.actionTaken,
          occurredAt: toIso(v.occurredAt),
          occurredAtMs: toMs(v.occurredAt),
          studentName: v.studentName,
          studentUsername: v.studentUsername,
          studentClass: v.studentClass,
          examTitle: v.examTitle,
          examCode: v.examCode,
        };
      })
      .filter((l) => !examIdFilterStr || l.examIdStr === examIdFilterStr)
      .sort((a, b) => b.occurredAtMs - a.occurredAtMs);

    return { exams: exs, logs } as T;
  }

  // 10. Student Routes
  if (pathname === '/api/student/exam-lookup' && method === 'POST') {
    const code = normalizeExamCode(body?.examCode);
    if (!code) throw new Error('Masukkan kode ujian terlebih dahulu.');
    return lookupExamByCodeForStudent(code, actor) as Promise<T>;
  }

  if (pathname === '/api/student/history' && method === 'GET') {
    const snap = await getDocs(
      query(
        collection(db, 'examSessions'),
        where('studentUid', '==', actor.uid)
      )
    ).catch((err) =>
      handleFirestoreError(err, OperationType.LIST, 'examSessions')
    );

    const history = snap.docs
      .map((d) => {
        const s = d.data();
        return {
          id: Number(s.numericId),
          examId: Number(s.examNumericId),
          examTitle: s.examTitle,
          subject: '',
          examCode: s.examCode,
          status: s.status,
          startedAt: toIso(s.startedAt),
          startedAtMs: toMs(s.startedAt),
          submittedAt: s.submittedAtMs
            ? new Date(s.submittedAtMs).toISOString()
            : null,
          violationCount: Number(s.violationCount) || 0,
          allowStudentViewResult: Boolean(s.allowStudentViewResult),
          finalScore: s.allowStudentViewResult ? Number(s.finalScore) || 0 : null,
          kkm: Number(s.kkm) || 75,
        };
      })
      .sort((a, b) => b.startedAtMs - a.startedAtMs);

    return { history } as T;
  }

  if (
    pathname.startsWith('/api/student/exams/') &&
    pathname.endsWith('/start') &&
    method === 'POST'
  ) {
    const examNumId = Number(pathname.split('/')[4]);
    const examId = `exam_${examNumId}`;
    const examSnap = await getDoc(doc(db, 'exams', examId)).catch((err) =>
      handleFirestoreError(err, OperationType.GET, `exams/${examId}`)
    );
    if (!examSnap.exists() || !examSnap.data().isPublished) {
      throw new Error('Ujian tidak tersedia.');
    }
    const exam = examSnap.data();

    const targetClasses: string[] = Array.isArray(exam.targetClasses)
      ? exam.targetClasses
      : [];
    if (
      targetClasses.length > 0 &&
      actor.role === 'siswa' &&
      !isStudentClassEligible(actor.className, targetClasses)
    ) {
      throw new Error(
        `Ujian ini khusus untuk kelas: ${targetClasses.join(', ')}.`
      );
    }

    const nowMs = Date.now();
    const startMs = toMs(exam.startTime);
    const endMs = toMs(exam.endTime);
    if (nowMs < startMs) {
      throw new Error('Ujian belum dapat dibuka sebelum jadwal dimulai.');
    }

    const sessionId = `${examId}_${actor.uid}`;
    const sessionRef = doc(db, 'examSessions', sessionId);
    let sessSnap = await getDoc(sessionRef).catch((err) =>
      handleFirestoreError(err, OperationType.GET, `examSessions/${sessionId}`)
    );

    let sData: any;
    if (!sessSnap.exists()) {
      if (nowMs > endMs) {
        throw new Error('Jadwal ujian telah berakhir.');
      }
      let candidateIds: number[] = Array.isArray(exam.questionIds)
        ? exam.questionIds.map(Number)
        : [];
      if (candidateIds.length === 0) {
        throw new Error('Ujian belum memiliki butir soal. Hubungi guru pengampu.');
      }
      if (exam.shuffleQuestions) {
        candidateIds = shuffleArray(candidateIds);
      }
      const selectedIds = candidateIds.slice(
        0,
        Math.max(1, Number(exam.questionCount) || candidateIds.length)
      );

      const items = await Promise.all(
        selectedIds.map(async (qNumId) => {
          const itemSnap = await getDoc(
            doc(db, 'exams', examId, 'items', `item_${qNumId}`)
          );
          return itemSnap.exists() ? itemSnap.data() : null;
        })
      );
      const validItems = items.filter(Boolean) as any[];
      const maxPossibleScore = validItems.reduce(
        (sum, it) => sum + (Number(it.points) || 10),
        0
      );
      const durationEndMs =
        nowMs + (Number(exam.durationMinutes) || 60) * 60 * 1000;
      const serverEndMs = Math.min(durationEndMs, endMs);
      const sessNumId = nextNumericId();

      const newSession = {
        id: sessionId,
        numericId: sessNumId,
        examId,
        examNumericId: Number(exam.numericId),
        examTitle: exam.title,
        examCode: exam.examCode,
        kkm: Number(exam.kkm) || 75,
        allowStudentViewResult: Boolean(exam.allowStudentViewResult),
        teacherUid: exam.teacherUid,
        studentUid: actor.uid,
        studentName: actor.name,
        studentUsername: actor.username,
        studentClass: actor.className || 'Umum',
        status: 'in_progress',
        questionOrder: selectedIds,
        startedAt: serverTimestamp(),
        serverEndTime: Timestamp.fromMillis(serverEndMs),
        submittedAtMs: 0,
        lastSavedAt: serverTimestamp(),
        violationCount: 0,
        autoScore: 0,
        essayScore: 0,
        maxPossibleScore,
        finalScore: 0,
        essayGraded: false,
        teacherNotes: '',
        answeredCount: 0,
      };
      await setDoc(sessionRef, newSession).catch((err) =>
        handleFirestoreError(
          err,
          OperationType.CREATE,
          `examSessions/${sessionId}`
        )
      );
      sessSnap = await getDoc(sessionRef);
      sData = sessSnap.data();
    } else {
      sData = sessSnap.data();
    }

    const qOrder: number[] = Array.isArray(sData.questionOrder)
      ? sData.questionOrder.map(Number)
      : [];
    const orderedQuestions = (
      await Promise.all(
        qOrder.map(async (qNumId) => {
          const itemSnap = await getDoc(
            doc(db, 'exams', examId, 'items', `item_${qNumId}`)
          );
          if (!itemSnap.exists()) return null;
          const q = itemSnap.data();
          let opts = Array.isArray(q.options) ? [...q.options] : [];
          if (exam.shuffleOptions && opts.length > 0) {
            opts = shuffleArray(opts);
          }
          return {
            id: Number(q.questionNumericId),
            subject: q.subject,
            type: q.type,
            prompt: q.prompt,
            imageData: q.imageData || null,
            points: Number(q.points) || 10,
            options: opts,
          };
        })
      )
    ).filter(Boolean);

    const ansSnap = await getDocs(
      query(
        collection(db, 'examSessions', sessionId, 'answers'),
        where('studentUid', '==', actor.uid)
      )
    ).catch((err) =>
      handleFirestoreError(
        err,
        OperationType.LIST,
        `examSessions/${sessionId}/answers`
      )
    );

    return {
      session: {
        id: Number(sData.numericId),
        examId: Number(exam.numericId),
        status: sData.status,
        startedAt: toIso(sData.startedAt),
        serverEndTime: toIso(sData.serverEndTime),
        submittedAt: sData.submittedAtMs
          ? new Date(sData.submittedAtMs).toISOString()
          : null,
        lastSavedAt: toIso(sData.lastSavedAt),
        violationCount: Number(sData.violationCount) || 0,
        finalScore: exam.allowStudentViewResult
          ? Number(sData.finalScore) || 0
          : null,
        essayGraded: Boolean(sData.essayGraded),
      },
      examConfig: {
        id: Number(exam.numericId),
        title: exam.title,
        subject: exam.subject,
        examCode: exam.examCode,
        kkm: Number(exam.kkm) || 75,
        allowStudentViewResult: Boolean(exam.allowStudentViewResult),
        requireFullscreen: exam.requireFullscreen !== false,
        detectTabSwitch: exam.detectTabSwitch !== false,
        detectWindowBlur: exam.detectWindowBlur !== false,
        blockCopyPaste: exam.blockCopyPaste !== false,
        maxViolations: Number(exam.maxViolations) || 3,
        violationAction:
          exam.violationAction === 'auto_submit' ? 'auto_submit' : 'suspend',
      },
      questions: orderedQuestions,
      answers: ansSnap.docs.map((ad) => {
        const a = ad.data();
        return {
          questionId: Number(a.questionId),
          answerText: a.answerText || '',
          isFlagged: Boolean(a.isFlagged),
          updatedAt: toIso(a.updatedAt),
        };
      }),
      serverNow: new Date().toISOString(),
    } as T;
  }

  if (pathname.startsWith('/api/student/sessions/')) {
    const parts = pathname.split('/');
    const sessionNumId = Number(parts[4]);
    const action = parts[5]; // 'autosave' | 'violations' | 'verify-proctor' | 'submit' | 'result'

    const sessSnap = await getDocs(
      query(
        collection(db, 'examSessions'),
        where('studentUid', '==', actor.uid),
        where('numericId', '==', sessionNumId)
      )
    ).catch((err) =>
      handleFirestoreError(err, OperationType.LIST, 'examSessions')
    );

    if (sessSnap.empty) {
      throw new Error('Sesi ujian tidak ditemukan.');
    }
    const sessionDoc = sessSnap.docs[0];
    const sData = sessionDoc.data();

    if (action === 'autosave' && method === 'POST') {
      if (sData.status === 'submitted' || sData.status === 'timed_out') {
        return {
          locked: true,
          status: sData.status,
          savedAt: toIso(sData.lastSavedAt),
          serverNow: new Date().toISOString(),
        } as T;
      }
      if (sData.status === 'suspended') {
        return {
          locked: true,
          status: 'suspended',
          savedAt: toIso(sData.lastSavedAt),
          serverNow: new Date().toISOString(),
        } as T;
      }

      const rawAnswers: Array<{
        questionId: number;
        answerText: string;
        isFlagged: boolean;
      }> = Array.isArray(body?.answers) ? body.answers : [];

      const existingAnsSnap = await getDocs(
        query(
          collection(db, 'examSessions', sessionDoc.id, 'answers'),
          where('studentUid', '==', actor.uid)
        )
      );
      const existingAnsMap = new Map(
        existingAnsSnap.docs.map((d) => [Number(d.data().questionId), d])
      );

      const batch = writeBatch(db);
      let answeredCount = 0;

      for (const item of rawAnswers) {
        const qId = Number(item.questionId);
        if (!Number.isInteger(qId) || qId <= 0) continue;
        const answerText = sanitizeText(item.answerText ?? '', 8000);
        const isFlagged = Boolean(item.isFlagged);
        if (answerText) answeredCount += 1;

        const ansId = `q_${qId}`;
        const ansRef = doc(db, 'examSessions', sessionDoc.id, 'answers', ansId);
        const existingDoc = existingAnsMap.get(qId);

        if (existingDoc) {
          const prev = existingDoc.data();
          if (prev.answerText !== answerText || prev.isFlagged !== isFlagged) {
            batch.update(ansRef, {
              answerText,
              isFlagged,
              updatedAt: serverTimestamp(),
            });
          }
        } else if (answerText || isFlagged) {
          batch.set(ansRef, {
            questionId: qId,
            studentUid: actor.uid,
            teacherUid: sData.teacherUid,
            answerText,
            isFlagged,
            autoPoints: 0,
            manualPoints: 0,
            isCorrect: false,
            updatedAt: serverTimestamp(),
          });
        }
      }

      const timedOut = Date.now() >= toMs(sData.serverEndTime);
      if (timedOut) {
        batch.update(sessionDoc.ref, {
          status: 'timed_out',
          submittedAtMs: Date.now(),
          answeredCount,
          lastSavedAt: serverTimestamp(),
        });
      } else {
        batch.update(sessionDoc.ref, {
          answeredCount,
          lastSavedAt: serverTimestamp(),
        });
      }

      await batch
        .commit()
        .catch((err) =>
          handleFirestoreError(
            err,
            OperationType.UPDATE,
            `examSessions/${sessionDoc.id}`
          )
        );

      return {
        locked: timedOut,
        status: timedOut ? 'timed_out' : 'in_progress',
        savedAt: new Date().toISOString(),
        serverNow: new Date().toISOString(),
      } as T;
    }

    if (action === 'violations' && method === 'POST') {
      const examSnap = await getDoc(doc(db, 'exams', sData.examId));
      const exam = examSnap.exists() ? examSnap.data() : {};
      const maxViolations = Number(exam.maxViolations) || 3;
      const violationAction =
        exam.violationAction === 'auto_submit' ? 'auto_submit' : 'suspend';

      if (sData.status === 'submitted' || sData.status === 'timed_out') {
        return {
          status: sData.status,
          violationCount: Number(sData.violationCount) || 0,
          maxViolations,
          actionTaken: 'ignored_finished',
        } as T;
      }

      const nextCount = (Number(sData.violationCount) || 0) + 1;
      let nextStatus = sData.status;
      let actionTaken: 'warning' | 'suspended' | 'auto_submitted' = 'warning';

      if (nextCount >= maxViolations) {
        if (violationAction === 'auto_submit') {
          nextStatus = 'submitted';
          actionTaken = 'auto_submitted';
        } else {
          nextStatus = 'suspended';
          actionTaken = 'suspended';
        }
      }

      const logNumId = nextNumericId();
      const logId = `log_${logNumId}`;
      const batch = writeBatch(db);
      batch.set(doc(db, 'violationLogs', logId), {
        id: logId,
        numericId: logNumId,
        sessionId: sessionDoc.id,
        examId: sData.examId,
        examTitle: sData.examTitle,
        examCode: sData.examCode,
        teacherUid: sData.teacherUid,
        studentUid: actor.uid,
        studentName: actor.name,
        studentUsername: actor.username,
        studentClass: actor.className || 'Umum',
        violationType: sanitizeText(body?.violationType, 40) || 'tab_switch',
        description:
          sanitizeText(body?.description, 500) ||
          'Terdeteksi aktivitas meninggalkan halaman ujian.',
        actionTaken,
        occurredAt: serverTimestamp(),
      });

      batch.update(sessionDoc.ref, {
        violationCount: nextCount,
        status: nextStatus,
        submittedAtMs:
          actionTaken === 'auto_submitted'
            ? Date.now()
            : Number(sData.submittedAtMs) || 0,
        lastSavedAt: serverTimestamp(),
      });

      await batch
        .commit()
        .catch((err) =>
          handleFirestoreError(
            err,
            OperationType.UPDATE,
            `examSessions/${sessionDoc.id}`
          )
        );

      return {
        status: nextStatus,
        violationCount: nextCount,
        maxViolations,
        actionTaken,
      } as T;
    }

    if (action === 'verify-proctor' && method === 'POST') {
      const pin = sanitizeText(body?.pin, 32);
      if (!pin) throw new Error('Masukkan PIN verifikasi guru.');
      const examSnap = await getDoc(doc(db, 'exams', sData.examId));
      if (!examSnap.exists()) throw new Error('Data ujian tidak ditemukan.');
      const expectedHash = examSnap.data().proctorPinHash;
      const candidateHash = await sha256Hex(`${sData.examId}:${pin}`);
      if (candidateHash !== expectedHash) {
        throw new Error(
          'PIN verifikasi guru salah. Minta guru pengawas memasukkan PIN yang benar.'
        );
      }

      if (Date.now() >= toMs(sData.serverEndTime)) {
        await updateDoc(sessionDoc.ref, {
          status: 'timed_out',
          submittedAtMs: Date.now(),
          lastSavedAt: serverTimestamp(),
        });
        return {
          unlocked: false,
          status: 'timed_out',
          message:
            'Waktu ujian telah habis saat penangguhan. Jawaban tersimpan telah dikirim otomatis.',
        } as T;
      }

      const logNumId = nextNumericId();
      const logId = `log_${logNumId}`;
      const batch = writeBatch(db);
      batch.update(sessionDoc.ref, {
        status: 'in_progress',
        lastSavedAt: serverTimestamp(),
      });
      batch.set(doc(db, 'violationLogs', logId), {
        id: logId,
        numericId: logNumId,
        sessionId: sessionDoc.id,
        examId: sData.examId,
        examTitle: sData.examTitle,
        examCode: sData.examCode,
        teacherUid: sData.teacherUid,
        studentUid: actor.uid,
        studentName: actor.name,
        studentUsername: actor.username,
        studentClass: actor.className || 'Umum',
        violationType: 'proctor_unlock',
        description: 'Guru pengawas memasukkan PIN untuk membuka penangguhan ujian.',
        actionTaken: 'unlocked_by_proctor',
        occurredAt: serverTimestamp(),
      });
      await batch
        .commit()
        .catch((err) =>
          handleFirestoreError(
            err,
            OperationType.UPDATE,
            `examSessions/${sessionDoc.id}`
          )
        );

      return {
        unlocked: true,
        status: 'in_progress',
        message: 'Penangguhan berhasil dibuka oleh guru pengawas.',
      } as T;
    }

    if (action === 'submit' && method === 'POST') {
      const rawAnswers: Array<{
        questionId: number;
        answerText: string;
        isFlagged: boolean;
      }> = Array.isArray(body?.answers) ? body.answers : [];

      let answeredCount = 0;
      if (sData.status === 'in_progress') {
        const existingAnsSnap = await getDocs(
          query(
            collection(db, 'examSessions', sessionDoc.id, 'answers'),
            where('studentUid', '==', actor.uid)
          )
        );
        const existingAnsMap = new Map(
          existingAnsSnap.docs.map((d) => [Number(d.data().questionId), d])
        );

        const batch = writeBatch(db);
        for (const item of rawAnswers) {
          const qId = Number(item.questionId);
          if (!Number.isInteger(qId) || qId <= 0) continue;
          const answerText = sanitizeText(item.answerText ?? '', 8000);
          const isFlagged = Boolean(item.isFlagged);
          if (answerText) answeredCount += 1;
          const ansId = `q_${qId}`;
          const ansRef = doc(db, 'examSessions', sessionDoc.id, 'answers', ansId);
          if (existingAnsMap.has(qId)) {
            batch.update(ansRef, {
              answerText,
              isFlagged,
              updatedAt: serverTimestamp(),
            });
          } else if (answerText || isFlagged) {
            batch.set(ansRef, {
              questionId: qId,
              studentUid: actor.uid,
              teacherUid: sData.teacherUid,
              answerText,
              isFlagged,
              autoPoints: 0,
              manualPoints: 0,
              isCorrect: false,
              updatedAt: serverTimestamp(),
            });
          }
        }

        const isTimedOut = Date.now() >= toMs(sData.serverEndTime);
        batch.update(sessionDoc.ref, {
          status: isTimedOut ? 'timed_out' : 'submitted',
          submittedAtMs: Date.now(),
          answeredCount,
          lastSavedAt: serverTimestamp(),
        });

        await batch
          .commit()
          .catch((err) =>
            handleFirestoreError(
              err,
              OperationType.UPDATE,
              `examSessions/${sessionDoc.id}`
            )
          );
      }

      return buildStudentResultPayload(sessionDoc.id, actor) as Promise<T>;
    }

    if (action === 'result' && method === 'GET') {
      return buildStudentResultPayload(sessionDoc.id, actor) as Promise<T>;
    }
  }

  throw new Error(`Endpoint tidak dikenali: ${method} ${pathname}`);
}

async function buildStudentResultPayload(sessionId: string, actor: AuthUser) {
  const sessSnap = await getDoc(doc(db, 'examSessions', sessionId)).catch((err) =>
    handleFirestoreError(err, OperationType.GET, `examSessions/${sessionId}`)
  );
  if (!sessSnap.exists()) throw new Error('Sesi ujian tidak ditemukan.');
  const sData = sessSnap.data();

  const examSnap = await getDoc(doc(db, 'exams', sData.examId));
  const exam = examSnap.exists() ? examSnap.data() : {};
  const allowResult = Boolean(sData.allowStudentViewResult);

  let finalScore: number | null = null;
  let autoScore: number | null = null;
  let essayScore: number | null = null;
  let essayGraded = Boolean(sData.essayGraded);

  const ansSnap = await getDocs(
    query(
      collection(db, 'examSessions', sessionId, 'answers'),
      where('studentUid', '==', actor.uid)
    )
  );
  const answeredCount = ansSnap.docs.filter((d) =>
    Boolean(String(d.data().answerText || '').trim())
  ).length;

  if (allowResult) {
    if (sData.essayGraded || Number(sData.finalScore) > 0) {
      autoScore = Number(sData.autoScore) || 0;
      essayScore = Number(sData.essayScore) || 0;
      finalScore = Number(sData.finalScore) || 0;
    } else {
      try {
        const keysSnap = await getDoc(
          doc(db, 'exams', sData.examId, 'private', 'keys')
        );
        if (keysSnap.exists()) {
          const entries: any[] = keysSnap.data().entries || [];
          const keyMap = new Map(
            entries.map((e) => [Number(e.questionNumericId), e])
          );
          let totalAuto = 0;
          let hasEssay = false;
          entries.forEach((e) => {
            if (e.type === 'uraian') hasEssay = true;
          });
          ansSnap.docs.forEach((ad) => {
            const a = ad.data();
            const k = keyMap.get(Number(a.questionId));
            if (k && k.type !== 'uraian') {
              const g = gradeObjectiveQuestion(
                k.type,
                k.correctAnswer,
                a.answerText || '',
                Number(k.points) || 0
              );
              totalAuto += g.autoPoints;
            }
          });
          const maxPossible = Number(sData.maxPossibleScore) || 100;
          autoScore =
            maxPossible > 0
              ? Math.min(100, Math.round((totalAuto / maxPossible) * 100))
              : 0;
          essayScore = 0;
          finalScore = autoScore;
          essayGraded = !hasEssay;
        }
      } catch {
        finalScore = Number(sData.finalScore) || 0;
      }
    }
  }

  const kkm = Number(sData.kkm) || 75;
  return {
    session: {
      id: Number(sData.numericId),
      status: sData.status,
      startedAt: toIso(sData.startedAt),
      submittedAt: sData.submittedAtMs
        ? new Date(sData.submittedAtMs).toISOString()
        : null,
      violationCount: Number(sData.violationCount) || 0,
      totalQuestions: Array.isArray(sData.questionOrder)
        ? sData.questionOrder.length
        : 0,
      answeredCount,
      allowStudentViewResult: allowResult,
      finalScore,
      autoScore,
      essayScore,
      maxPossibleScore: allowResult ? Number(sData.maxPossibleScore) || 100 : null,
      kkm,
      passedKkm:
        allowResult && finalScore !== null ? finalScore >= kkm : null,
      essayGraded,
      teacherNotes: sData.teacherNotes || '',
    },
    exam: {
      id: Number(sData.examNumericId),
      title: sData.examTitle,
      subject: exam.subject || '',
      examCode: sData.examCode,
    },
  };
}

export async function lookupExamByCodeForStudent(
  examCode: string,
  actor: AuthUser
): Promise<ExamLookupResponse> {
  const code = normalizeExamCode(examCode);
  const codeSnap = await getDoc(doc(db, 'examCodes', code)).catch((err) =>
    handleFirestoreError(err, OperationType.GET, `examCodes/${code}`)
  );

  if (!codeSnap.exists() || !codeSnap.data().isPublished) {
    throw new Error(
      'Kode ujian tidak ditemukan atau belum dipublikasikan oleh guru.'
    );
  }
  const examId = codeSnap.data().examId;
  const examSnap = await getDoc(doc(db, 'exams', examId)).catch((err) =>
    handleFirestoreError(err, OperationType.GET, `exams/${examId}`)
  );
  if (!examSnap.exists() || !examSnap.data().isPublished) {
    throw new Error(
      'Kode ujian tidak ditemukan atau belum dipublikasikan oleh guru.'
    );
  }
  const exam = examSnap.data();
  const targetClasses: string[] = Array.isArray(exam.targetClasses)
    ? exam.targetClasses
    : [];

  if (
    targetClasses.length > 0 &&
    actor.role === 'siswa' &&
    !isStudentClassEligible(actor.className, targetClasses)
  ) {
    throw new Error(
      `Ujian ini khusus untuk kelas: ${targetClasses.join(', ')}. Kelas Anda (${
        actor.className || 'Belum diatur'
      }) tidak terdaftar.`
    );
  }

  const sessionId = `${examId}_${actor.uid}`;
  let existingSession: ExamLookupResponse['existingSession'] = null;
  try {
    const sessSnap = await getDoc(doc(db, 'examSessions', sessionId));
    if (sessSnap.exists()) {
      const s = sessSnap.data();
      existingSession = {
        id: Number(s.numericId),
        status: s.status,
        startedAt: toIso(s.startedAt),
        serverEndTime: toIso(s.serverEndTime),
        submittedAt: s.submittedAtMs
          ? new Date(s.submittedAtMs).toISOString()
          : null,
        violationCount: Number(s.violationCount) || 0,
        finalScore: exam.allowStudentViewResult
          ? Number(s.finalScore) || 0
          : null,
        essayGraded: Boolean(s.essayGraded),
      };
    }
  } catch {
    // No existing session
  }

  const now = Date.now();
  const startMs = toMs(exam.startTime);
  const endMs = toMs(exam.endTime);
  let availability: 'before_schedule' | 'after_schedule' | 'open' = 'open';
  if (now < startMs) availability = 'before_schedule';
  else if (now > endMs) availability = 'after_schedule';

  const qCount = Array.isArray(exam.questionIds)
    ? Math.min(Number(exam.questionCount) || 10, exam.questionIds.length)
    : Number(exam.questionCount) || 10;

  return {
    exam: {
      id: Number(exam.numericId),
      title: exam.title,
      subject: exam.subject,
      examCode: exam.examCode,
      description: exam.description || '',
      durationMinutes: Number(exam.durationMinutes) || 60,
      startTime: toIso(exam.startTime),
      endTime: toIso(exam.endTime),
      questionCount: qCount,
      kkm: Number(exam.kkm) || 75,
      allowStudentViewResult: Boolean(exam.allowStudentViewResult),
      requireFullscreen: exam.requireFullscreen !== false,
      detectTabSwitch: exam.detectTabSwitch !== false,
      detectWindowBlur: exam.detectWindowBlur !== false,
      blockCopyPaste: exam.blockCopyPaste !== false,
      maxViolations: Number(exam.maxViolations) || 3,
      violationAction:
        exam.violationAction === 'auto_submit' ? 'auto_submit' : 'suspend',
      targetClasses,
    },
    availability,
    serverNow: new Date().toISOString(),
    existingSession,
  };
}
