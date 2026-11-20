# MKC CBT Firestore Security Specification (`security_spec.md`)

## 1. Data Invariants
1. **Master Gate & Default Deny**: All Firestore paths not explicitly matched are denied by `match /{document=**} { allow read, write: if false; }`.
2. **Verified Identity**: Every authenticated read/write requires `request.auth != null && request.auth.token.email_verified == true`.
3. **No Self-Assigned Roles**: A user registering their own `/users/{userId}` document may only assign `role: 'siswa'` unless they are the bootstrapped admin (`izanalhuda@gmail.com`) or hold a verified admin-created invitation in `/teacherInvites/{emailKey}`.
4. **PII Isolation**: User email addresses are isolated in `/users/{userId}/private/info` and are only readable by the document owner or a verified Super Admin.
5. **Answer Key & Proctor PIN Isolation**: Question answer keys (`/questions`, `/exams/{examId}/private/keys`) and proctor PINs (`/exams/{examId}/private/config`) are unreadable by students during an active exam session. Answer keys under `/exams/{examId}/private/keys` may only be fetched (`get`) by a student after their session reaches terminal status (`submitted` or `timed_out`) and only when `allowStudentViewResult == true`.
6. **Terminal State Locking**: Once an `examSessions/{sessionId}` document reaches `status == 'submitted'` or `status == 'timed_out'`, students can never update the session or any answer under `/examSessions/{sessionId}/answers/{answerId}`.
7. **Server Timestamps & Bounded Payloads**: All `createdAt`, `updatedAt`, `lastSavedAt`, `startedAt`, and `occurredAt` fields must equal `request.time`. All strings and arrays have strict upper size bounds.
8. **Zero DB Lookups in List Rules**: `allow list` rules evaluate solely against `resource.data` fields (`teacherUid`, `studentUid`, `createdByUid`) or `request.auth.token.email` without invoking `get()` or `exists()`.

## 2. The "Dirty Dozen" Adversarial Payloads
1. **Unauthenticated Write**: Creating `/questions/q_1` with `request.auth == null` -> `PERMISSION_DENIED`.
2. **Unverified Email Spoofing**: Writing `/portalSettings/main` with `email == 'izanalhuda@gmail.com'` and `email_verified == false` -> `PERMISSION_DENIED`.
3. **Privilege Escalation (Self-Assigned Role)**: New student user creating `/users/{uid}` with `role: 'super_admin'` or `role: 'guru'` without an admin invite -> `PERMISSION_DENIED`.
4. **Role Escalation via Profile Update**: Existing student updating `/users/{uid}` changing `role` from `'siswa'` to `'guru'` -> `PERMISSION_DENIED`.
5. **Shadow Field Injection**: Creating `/questions/q_1` with an extra ghost key `isApproved: true` -> `PERMISSION_DENIED`.
6. **PII Cross-Read**: Student A reading `/users/{studentB}/private/info` -> `PERMISSION_DENIED`.
7. **Answer Key Snooping During Exam**: Student with `examSessions/{examId}_{uid}.status == 'in_progress'` reading `/exams/{examId}/private/keys` -> `PERMISSION_DENIED`.
8. **Proctor PIN Snooping**: Student reading `/exams/{examId}/private/config` -> `PERMISSION_DENIED`.
9. **Terminal State Tampering**: Student updating `/examSessions/{sessionId}` or `/examSessions/{sessionId}/answers/{qId}` after `status == 'submitted'` -> `PERMISSION_DENIED`.
10. **Score Self-Modification**: Student updating `autoScore`, `essayScore`, or `finalScore` on `/examSessions/{sessionId}` -> `PERMISSION_DENIED`.
11. **Path ID Poisoning**: Creating or reading `/exams/invalid..id/with/slashes` or >128 char document ID -> `PERMISSION_DENIED`.
12. **Client Timestamp Forgery**: Creating `/violationLogs/{logId}` with a backdated `occurredAt` not equal to `request.time` -> `PERMISSION_DENIED`.
