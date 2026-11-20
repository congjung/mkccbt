/**
 * Security test specification verifying the "Dirty Dozen" adversarial payloads
 * against the MKC CBT Firestore security rules.
 *
 * Each scenario defines the actor auth context, target path, operation, payload,
 * and expected PERMISSION_DENIED outcome enforced by firestore.rules.
 */

export interface SecurityTestCase {
  id: string;
  name: string;
  actor: {
    uid: string | null;
    email?: string;
    emailVerified?: boolean;
  };
  operation: 'get' | 'list' | 'create' | 'update' | 'delete';
  path: string;
  payload?: Record<string, unknown>;
  expected: 'PERMISSION_DENIED';
}

export const DIRTY_DOZEN_TESTS: SecurityTestCase[] = [
  {
    id: 'DD-01',
    name: 'Unauthenticated write to questions',
    actor: { uid: null },
    operation: 'create',
    path: 'questions/q_999',
    payload: { id: 'q_999', teacherUid: 'anon' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 'DD-02',
    name: 'Email spoofing with email_verified=false on admin path',
    actor: { uid: 'spoof_uid', email: 'izanalhuda@gmail.com', emailVerified: false },
    operation: 'update',
    path: 'portalSettings/main',
    payload: { schoolName: 'Hacked School' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 'DD-03',
    name: 'Self-assigned super_admin role on user registration',
    actor: { uid: 'student_1', email: 'student1@school.id', emailVerified: true },
    operation: 'create',
    path: 'users/student_1',
    payload: {
      uid: 'student_1',
      numericId: 100,
      username: 'student1',
      name: 'Evil Student',
      role: 'super_admin',
      className: 'XII',
    },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 'DD-04',
    name: 'Student attempting to escalate role via profile update',
    actor: { uid: 'student_1', email: 'student1@school.id', emailVerified: true },
    operation: 'update',
    path: 'users/student_1',
    payload: { role: 'guru' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 'DD-05',
    name: 'Shadow ghost field injection on question creation',
    actor: { uid: 'teacher_1', email: 'teacher1@school.id', emailVerified: true },
    operation: 'create',
    path: 'questions/q_100',
    payload: {
      id: 'q_100',
      numericId: 100,
      teacherUid: 'teacher_1',
      ghostAdminFlag: true,
    },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 'DD-06',
    name: 'Cross-user PII read on /users/{otherUid}/private/info',
    actor: { uid: 'student_1', email: 'student1@school.id', emailVerified: true },
    operation: 'get',
    path: 'users/student_2/private/info',
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 'DD-07',
    name: 'Student reading exam answer keys while exam session is in_progress',
    actor: { uid: 'student_1', email: 'student1@school.id', emailVerified: true },
    operation: 'get',
    path: 'exams/exam_1/private/keys',
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 'DD-08',
    name: 'Student reading proctor PIN config',
    actor: { uid: 'student_1', email: 'student1@school.id', emailVerified: true },
    operation: 'get',
    path: 'exams/exam_1/private/config',
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 'DD-09',
    name: 'Student mutating answer after session reached terminal submitted state',
    actor: { uid: 'student_1', email: 'student1@school.id', emailVerified: true },
    operation: 'update',
    path: 'examSessions/exam_1_student_1/answers/q_1',
    payload: { answerText: 'A', isFlagged: false },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 'DD-10',
    name: 'Student tampering with autoScore / finalScore on examSession',
    actor: { uid: 'student_1', email: 'student1@school.id', emailVerified: true },
    operation: 'update',
    path: 'examSessions/exam_1_student_1',
    payload: { autoScore: 100, finalScore: 100 },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 'DD-11',
    name: 'Path ID poisoning with oversized/invalid characters',
    actor: { uid: 'teacher_1', email: 'teacher1@school.id', emailVerified: true },
    operation: 'create',
    path: `exams/${'x'.repeat(200)}`,
    payload: { title: 'Poison' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 'DD-12',
    name: 'Client timestamp forgery on violationLogs',
    actor: { uid: 'student_1', email: 'student1@school.id', emailVerified: true },
    operation: 'create',
    path: 'violationLogs/log_1',
    payload: {
      id: 'log_1',
      occurredAt: '2020-01-01T00:00:00Z',
    },
    expected: 'PERMISSION_DENIED',
  },
];
