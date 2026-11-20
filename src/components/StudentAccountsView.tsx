import { ChangeEvent, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertCircle,
  CheckCircle2,
  CheckSquare,
  Download,
  FileSpreadsheet,
  Plus,
  Printer,
  Search,
  Square,
  Trash2,
  Upload,
  UserPlus,
  X,
} from 'lucide-react';
import { api, formatDateTime } from '../lib/api';
import {
  downloadStudentExcelTemplate,
  ParsedImportedStudent,
  parseStudentExcelFile,
} from '../lib/studentExcel';
import { ExamItem, PublicPortalInfo, StudentAccount } from '../types/cbt';

export function StudentAccountsView() {
  const [students, setStudents] = useState<StudentAccount[]>([]);
  const [exams, setExams] = useState<ExamItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [lastSavedClasses, setLastSavedClasses] = useState<string[]>([]);

  const [search, setSearch] = useState('');
  const [classFilter, setClassFilter] = useState('all');
  const [selectedIds, setSelectedIds] = useState<number[]>([]);

  // Single create modal
  const [modalOpen, setModalOpen] = useState(false);
  const [username, setUsername] = useState('');
  const [name, setName] = useState('');
  const [className, setClassName] = useState('XII IPA 1');
  const [customClassMode, setCustomClassMode] = useState(false);
  const [pin, setPin] = useState('123456');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Excel import modal
  const [importOpen, setImportOpen] = useState(false);
  const [importFileName, setImportFileName] = useState('');
  const [importTargetClass, setImportTargetClass] = useState('__from_file__');
  const [importCustomClass, setImportCustomClass] = useState('');
  const [parsedRows, setParsedRows] = useState<ParsedImportedStudent[]>([]);
  const [skipExamples, setSkipExamples] = useState(true);
  const [selectedImportIds, setSelectedImportIds] = useState<string[]>([]);
  const [parsingExcel, setParsingExcel] = useState(false);
  const [importingExcel, setImportingExcel] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  // Print exam cards modal
  const [cardsOpen, setCardsOpen] = useState(false);
  const [schoolName, setSchoolName] = useState('SDN 09 SADANIANG');
  const [cardTitle, setCardTitle] = useState('KARTU PESERTA TES AKHIR SEMESTER');
  const [academicYear, setAcademicYear] = useState('Tahun Pelajaran 2026/2027');
  const [selectedExamId, setSelectedExamId] = useState<string>('');
  const [cardTargetIds, setCardTargetIds] = useState<number[] | null>(null);
  const [cardClassFilter, setCardClassFilter] = useState<string>('all');

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [stuRes, examRes, portalRes] = await Promise.all([
        api.request<{ students: StudentAccount[] }>('/api/teacher/students'),
        api.request<{ exams: ExamItem[] }>('/api/teacher/exams'),
        api.request<PublicPortalInfo>('/api/public/portal-info').catch(() => null),
      ]);
      setStudents(stuRes.students);
      setExams(examRes.exams);
      if (portalRes) {
        setSchoolName(portalRes.schoolName);
        if (portalRes.examTheme) {
          setCardTitle(`KARTU PESERTA ${portalRes.examTheme.toUpperCase()}`);
        }
        if (portalRes.academicYear) {
          setAcademicYear(portalRes.academicYear);
        }
      }
    } catch (err: any) {
      setError(err.message || 'Gagal memuat data siswa.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const classCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of students) {
      const cls = s.className?.trim();
      if (cls) {
        map.set(cls, (map.get(cls) || 0) + 1);
      }
    }
    return map;
  }, [students]);

  const availableClasses = useMemo(
    () => Array.from(classCounts.keys()).sort((a, b) => a.localeCompare(b, 'id')),
    [classCounts]
  );

  const filteredStudents = useMemo(() => {
    const q = search.trim().toLowerCase();
    return students.filter((s) => {
      if (classFilter !== 'all' && s.className.trim() !== classFilter) {
        return false;
      }
      if (!q) return true;
      return (
        s.username.toLowerCase().includes(q) ||
        s.name.toLowerCase().includes(q) ||
        s.className.toLowerCase().includes(q)
      );
    });
  }, [students, search, classFilter]);

  const toggleSelectStudent = (id: number) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const toggleSelectAllFiltered = () => {
    const ids = filteredStudents.map((s) => s.id);
    const allSelected = ids.length > 0 && ids.every((id) => selectedIds.includes(id));
    setSelectedIds(allSelected ? [] : ids);
  };

  const openCreateModal = () => {
    setFormError(null);
    const defaultClass =
      classFilter !== 'all'
        ? classFilter
        : availableClasses[0] || '';
    setClassName(defaultClass);
    setCustomClassMode(availableClasses.length === 0);
    setModalOpen(true);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const finalClass = className.trim() || 'Umum';
    setSaving(true);
    try {
      await api.request('/api/teacher/students', {
        method: 'POST',
        body: JSON.stringify({ username, name, className: finalClass, pin }),
      });
      setModalOpen(false);
      setUsername('');
      setName('');
      setPin('123456');
      setLastSavedClasses([finalClass]);
      setClassFilter(finalClass);
      setSuccessMsg(`Akun siswa baru (${finalClass}) berhasil ditambahkan.`);
      await loadData();
    } catch (err: any) {
      setFormError(err.message || 'Gagal menambah siswa.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await api.request(`/api/teacher/students/${id}`, { method: 'DELETE' });
      setStudents((prev) => prev.filter((s) => s.id !== id));
      setSelectedIds((prev) => prev.filter((sid) => sid !== id));
    } catch (err: any) {
      setError(err.message || 'Gagal menghapus siswa.');
    }
  };

  const openImportModal = () => {
    setImportFileName('');
    setImportTargetClass(classFilter !== 'all' ? classFilter : '__from_file__');
    setImportCustomClass('');
    setParsedRows([]);
    setSelectedImportIds([]);
    setImportError(null);
    setImportOpen(true);
  };

  const resolveImportOverrideClass = (
    target: string,
    customVal: string
  ): string | null => {
    if (target === '__from_file__') return null;
    if (target === '__custom__') return customVal.trim() || null;
    return target.trim() || null;
  };

  const handleExcelUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setImportError(null);
    setImportFileName(file.name);
    setParsingExcel(true);
    try {
      const parsed = await parseStudentExcelFile(file);
      const overrideClass = resolveImportOverrideClass(
        importTargetClass,
        importCustomClass
      );
      const adjusted = overrideClass
        ? parsed.map((r) => ({ ...r, className: overrideClass }))
        : parsed;
      setParsedRows(adjusted);
      setSelectedImportIds(
        adjusted
          .filter((r) => !r.validationError && (!skipExamples || !r.isExample))
          .map((r) => r.tempId)
      );
    } catch (err: any) {
      setParsedRows([]);
      setSelectedImportIds([]);
      setImportError(err.message || 'Gagal membaca file Excel.');
    } finally {
      setParsingExcel(false);
    }
  };

  const handleImportTargetClassChange = (nextTarget: string) => {
    setImportTargetClass(nextTarget);
    const overrideClass = resolveImportOverrideClass(nextTarget, importCustomClass);
    if (overrideClass && parsedRows.length > 0) {
      setParsedRows((prev) => prev.map((r) => ({ ...r, className: overrideClass })));
    }
  };

  const updateImportedRowClass = (tempId: string, nextClass: string) => {
    setParsedRows((prev) =>
      prev.map((r) =>
        r.tempId === tempId ? { ...r, className: nextClass.trim() || 'Umum' } : r
      )
    );
  };

  const handleToggleSkipExamples = (next: boolean) => {
    setSkipExamples(next);
    if (parsedRows.length > 0) {
      setSelectedImportIds(
        parsedRows
          .filter((r) => !r.validationError && (!next || !r.isExample))
          .map((r) => r.tempId)
      );
    }
  };

  const visibleImportRows = useMemo(() => {
    if (!skipExamples) return parsedRows;
    return parsedRows.filter((r) => !r.isExample);
  }, [parsedRows, skipExamples]);

  const handleConfirmExcelImport = async () => {
    const chosen = parsedRows.filter(
      (r) => selectedImportIds.includes(r.tempId) && !r.validationError
    );
    if (chosen.length === 0) {
      setImportError('Pilih minimal 1 akun siswa yang valid untuk diimpor.');
      return;
    }

    setImportError(null);
    setImportingExcel(true);
    try {
      const res = await api.request<{
        importedCount: number;
        skippedUsernames: string[];
      }>('/api/teacher/students/import', {
        method: 'POST',
        body: JSON.stringify({
          students: chosen.map((r) => ({
            username: r.username,
            name: r.name,
            className: r.className,
            pin: r.pin,
          })),
        }),
      });
      setImportOpen(false);
      const importedClasses = Array.from(
        new Set(chosen.map((r) => r.className.trim()).filter(Boolean))
      );
      setLastSavedClasses(importedClasses);
      if (importedClasses.length === 1) {
        setClassFilter(importedClasses[0]);
      }
      const skippedText =
        res.skippedUsernames.length > 0
          ? ` (${res.skippedUsernames.length} username sudah terdaftar dilewati: ${res.skippedUsernames
              .slice(0, 5)
              .join(', ')}${res.skippedUsernames.length > 5 ? ', ...' : ''})`
          : '';
      setSuccessMsg(
        `Berhasil mengimpor ${res.importedCount} akun siswa dari Excel.${skippedText}`
      );
      await loadData();
    } catch (err: any) {
      setImportError(err.message || 'Gagal mengimpor akun siswa.');
    } finally {
      setImportingExcel(false);
    }
  };

  const openPrintCardsForClass = (cls: string) => {
    setCardTargetIds(null);
    setCardClassFilter(cls);
    setCardsOpen(true);
  };

  const openPrintCards = (specificIds?: number[]) => {
    if (specificIds && specificIds.length > 0) {
      setCardTargetIds(specificIds);
      setCardClassFilter('selected');
    } else if (selectedIds.length > 0) {
      setCardTargetIds(selectedIds);
      setCardClassFilter('selected');
    } else {
      setCardTargetIds(null);
      setCardClassFilter(classFilter !== 'all' ? classFilter : 'all');
    }
    setCardsOpen(true);
  };

  const selectedExam = useMemo(
    () => exams.find((ex) => String(ex.id) === selectedExamId) || null,
    [exams, selectedExamId]
  );

  const cardsToPrint = useMemo(() => {
    let base = students;
    if (cardClassFilter === 'selected' && cardTargetIds && cardTargetIds.length > 0) {
      const idSet = new Set(cardTargetIds);
      base = base.filter((s) => idSet.has(s.id));
    } else if (cardClassFilter !== 'all' && cardClassFilter !== 'selected') {
      base = base.filter((s) => s.className.trim() === cardClassFilter);
    }

    if (
      cardClassFilter !== 'selected' &&
      selectedExam &&
      selectedExam.targetClasses &&
      selectedExam.targetClasses.length > 0
    ) {
      const allowed = new Set(
        selectedExam.targetClasses.map((c) => c.trim().toLowerCase())
      );
      base = base.filter((s) => allowed.has(s.className.trim().toLowerCase()));
    }
    return base;
  }, [students, cardClassFilter, cardTargetIds, selectedExam]);

  const handlePrintCards = () => {
    document.body.classList.add('print-cards-mode');
    const cleanup = () => {
      document.body.classList.remove('print-cards-mode');
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);
    setTimeout(() => {
      window.print();
      setTimeout(cleanup, 1200);
    }, 60);
  };

  const renderExamCard = (st: StudentAccount) => (
    <div
      key={st.id}
      className="exam-card-item bg-white border border-slate-400 rounded-lg overflow-hidden text-slate-900"
    >
      <div className="bg-blue-700 text-white px-3.5 py-2 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold tracking-wide uppercase opacity-90 truncate">
            {schoolName || 'SEKOLAH'}
          </p>
          <p className="text-xs font-bold leading-tight truncate">
            {cardTitle || 'KARTU PESERTA UJIAN CBT'}
          </p>
        </div>
        <span className="text-[10px] font-mono font-bold bg-white/15 px-2 py-0.5 rounded shrink-0">
          {st.className}
        </span>
      </div>

      <div className="p-3.5 space-y-2.5 text-xs">
        <div className="grid grid-cols-3 gap-y-1.5 text-[11px]">
          <span className="text-slate-500">Nama Peserta</span>
          <span className="col-span-2 font-bold text-slate-900 uppercase">
            : {st.name}
          </span>

          <span className="text-slate-500">Kelas / Rombel</span>
          <span className="col-span-2 font-semibold text-slate-800">
            : {st.className}
          </span>

          <span className="text-slate-500">Username / NIS</span>
          <span className="col-span-2 font-mono font-bold text-blue-700">
            : {st.username}
          </span>

          <span className="text-slate-500">PIN Login</span>
          <span className="col-span-2 font-mono font-bold text-slate-900">
            : {st.accessPin || 'Sesuai data guru'}
          </span>

          {selectedExam && (
            <>
              <span className="text-slate-500">Kode Ujian</span>
              <span className="col-span-2 font-mono font-bold text-emerald-700">
                : {selectedExam.examCode}
              </span>

              <span className="text-slate-500">Ujian / Mapel</span>
              <span className="col-span-2 font-semibold text-slate-800 truncate">
                : {selectedExam.title}
              </span>
            </>
          )}
        </div>

        <div className="pt-2 border-t border-dashed border-slate-300 flex items-end justify-between text-[10px] text-slate-500">
          <div>
            <p>{academicYear}</p>
            {selectedExam && (
              <p className="tabular-nums">
                Durasi {selectedExam.durationMinutes} mnt · KKM {selectedExam.kkm}
              </p>
            )}
          </div>
          <div className="text-right">
            <p className="mb-3">Panitia Ujian,</p>
            <p className="border-t border-slate-400 pt-0.5 px-2 text-slate-700 font-medium">
              Ttd / Stempel
            </p>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="space-y-5">
      <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col xl:flex-row xl:items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-lg font-bold text-slate-900">
            Manajemen Akun Peserta / Siswa
          </h2>
          <p className="text-sm text-slate-500">
            Kelola akun siswa satuan atau impor massal lewat template Excel (.xlsx) dan cetak kartu ujian peserta.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => downloadStudentExcelTemplate()}
            className="px-3.5 py-2.5 bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 text-xs font-semibold rounded-lg flex items-center gap-2 whitespace-nowrap cursor-pointer"
          >
            <FileSpreadsheet className="w-4 h-4 text-emerald-700" />
            <span>Template Excel (.xlsx)</span>
          </button>
          <button
            type="button"
            onClick={openImportModal}
            className="px-3.5 py-2.5 bg-blue-50 hover:bg-blue-100 border border-blue-200 text-blue-800 text-xs font-semibold rounded-lg flex items-center gap-2 whitespace-nowrap cursor-pointer"
          >
            <Upload className="w-4 h-4" />
            <span>Import Excel</span>
          </button>
          <button
            type="button"
            disabled={students.length === 0}
            onClick={() => openPrintCards()}
            className="px-3.5 py-2.5 bg-white hover:bg-slate-50 disabled:opacity-50 border border-slate-300 text-slate-800 text-xs font-semibold rounded-lg flex items-center gap-2 whitespace-nowrap cursor-pointer"
          >
            <Printer className="w-4 h-4 text-blue-700" />
            <span>
              {selectedIds.length > 0
                ? `Cetak Kartu Terpilih (${selectedIds.length})`
                : classFilter !== 'all'
                ? `Cetak Kartu Kelas ${classFilter} (${filteredStudents.length})`
                : 'Cetak Kartu Ujian'}
            </span>
          </button>
          <button
            type="button"
            onClick={openCreateModal}
            className="px-4 py-2.5 bg-blue-700 hover:bg-blue-800 text-white text-sm font-semibold rounded-lg flex items-center gap-2 whitespace-nowrap cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Tambah Siswa</span>
          </button>
        </div>
      </div>

      {successMsg && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl text-sm text-emerald-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
            <span>{successMsg}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {lastSavedClasses.map((cls) => (
              <button
                key={cls}
                type="button"
                onClick={() => openPrintCardsForClass(cls)}
                className="px-3 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold rounded-lg flex items-center gap-1.5 cursor-pointer"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>Cetak Kartu Kelas {cls}</span>
              </button>
            ))}
            <button
              type="button"
              onClick={() => {
                setSuccessMsg(null);
                setLastSavedClasses([]);
              }}
              className="text-xs font-semibold text-emerald-700 hover:underline cursor-pointer px-2"
            >
              Tutup
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari username, nama siswa, atau kelas..."
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs font-semibold text-slate-600 whitespace-nowrap">
            Pilih Kelas:
          </label>
          <select
            value={classFilter}
            onChange={(e) => setClassFilter(e.target.value)}
            className="px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white"
          >
            <option value="all">Semua Kelas ({students.length} siswa)</option>
            {availableClasses.map((cls) => (
              <option key={cls} value={cls}>
                {cls} ({classCounts.get(cls) || 0} siswa)
              </option>
            ))}
          </select>
          {classFilter !== 'all' && filteredStudents.length > 0 && (
            <button
              type="button"
              onClick={() => openPrintCardsForClass(classFilter)}
              className="px-3 py-2 bg-blue-700 hover:bg-blue-800 text-white text-xs font-semibold rounded-lg flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Cetak Kelas {classFilter}</span>
            </button>
          )}
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-sm text-slate-500">
            Memuat daftar siswa...
          </div>
        ) : filteredStudents.length === 0 ? (
          <div className="p-10 text-center space-y-3">
            <UserPlus className="w-8 h-8 text-slate-300 mx-auto" />
            <p className="text-sm text-slate-600">
              {students.length === 0
                ? 'Belum ada akun siswa terdaftar.'
                : 'Tidak ada siswa yang sesuai filter pencarian.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                  <th className="py-3 px-4 w-10">
                    <button
                      type="button"
                      onClick={toggleSelectAllFiltered}
                      aria-label="Pilih semua siswa"
                      className="cursor-pointer flex items-center"
                    >
                      {filteredStudents.length > 0 &&
                      filteredStudents.every((s) => selectedIds.includes(s.id)) ? (
                        <CheckSquare className="w-4 h-4 text-blue-700" />
                      ) : (
                        <Square className="w-4 h-4 text-slate-400" />
                      )}
                    </button>
                  </th>
                  <th className="py-3 px-4">Username / NIS</th>
                  <th className="py-3 px-4">Nama Lengkap</th>
                  <th className="py-3 px-4">Kelas</th>
                  <th className="py-3 px-4">PIN Kartu</th>
                  <th className="py-3 px-4">Terdaftar</th>
                  <th className="py-3 px-4 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredStudents.map((st) => {
                  const isChecked = selectedIds.includes(st.id);
                  return (
                    <tr key={st.id} className="hover:bg-slate-50/70">
                      <td className="py-3 px-4">
                        <button
                          type="button"
                          onClick={() => toggleSelectStudent(st.id)}
                          aria-label={`Pilih ${st.name}`}
                          className="cursor-pointer flex items-center"
                        >
                          {isChecked ? (
                            <CheckSquare className="w-4 h-4 text-blue-700" />
                          ) : (
                            <Square className="w-4 h-4 text-slate-400" />
                          )}
                        </button>
                      </td>
                      <td className="py-3 px-4 font-mono text-xs font-bold text-blue-700">
                        {st.username}
                      </td>
                      <td className="py-3 px-4 font-semibold text-slate-900">
                        {st.name}
                      </td>
                      <td className="py-3 px-4 text-slate-700">{st.className}</td>
                      <td className="py-3 px-4 font-mono text-xs text-slate-700">
                        {st.accessPin || '—'}
                      </td>
                      <td className="py-3 px-4 text-xs text-slate-500 tabular-nums">
                        {formatDateTime(st.createdAt)}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => openPrintCards([st.id])}
                            className="px-2.5 py-1.5 border border-slate-200 hover:border-blue-600 text-blue-700 rounded-md text-xs font-semibold inline-flex items-center gap-1 cursor-pointer"
                          >
                            <Printer className="w-3.5 h-3.5" />
                            <span>Kartu</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(st.id)}
                            className="px-2.5 py-1.5 border border-red-200 hover:bg-red-50 text-red-700 rounded-md text-xs font-semibold inline-flex items-center gap-1 cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>Hapus</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal Tambah Siswa Satuan */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3 className="font-display text-base font-bold text-slate-900">
                Tambah Akun Siswa Baru
              </h3>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {formError && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                {formError}
              </div>
            )}

            <form onSubmit={handleCreate} className="space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Username / NIS
                </label>
                <input
                  type="text"
                  required
                  minLength={3}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Contoh: siswa04"
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Nama Lengkap
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Nama lengkap peserta"
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Pilih Kelas
                </label>
                {availableClasses.length > 0 && (
                  <select
                    value={customClassMode ? '__custom__' : className}
                    onChange={(e) => {
                      if (e.target.value === '__custom__') {
                        setCustomClassMode(true);
                        setClassName('');
                      } else {
                        setCustomClassMode(false);
                        setClassName(e.target.value);
                      }
                    }}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white"
                  >
                    {availableClasses.map((cls) => (
                      <option key={cls} value={cls}>
                        {cls} ({classCounts.get(cls) || 0} siswa)
                      </option>
                    ))}
                    <option value="__custom__">+ Tambah Kelas Baru...</option>
                  </select>
                )}
                {(customClassMode || availableClasses.length === 0) && (
                  <input
                    type="text"
                    required
                    value={className}
                    onChange={(e) => setClassName(e.target.value)}
                    placeholder="Contoh: VI A atau XII IPA 1"
                    className={`${
                      availableClasses.length > 0 ? 'mt-2 border-blue-300' : 'border-slate-300'
                    } w-full px-3 py-2 rounded-lg border text-sm`}
                  />
                )}
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  PIN Masuk Siswa (disimpan terenkripsi &amp; tampil di Kartu Ujian)
                </label>
                <input
                  type="text"
                  required
                  minLength={4}
                  value={pin}
                  onChange={(e) => setPin(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm font-mono"
                />
              </div>
              <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="px-4 py-2 border border-slate-300 text-slate-700 text-sm rounded-lg cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 bg-blue-700 hover:bg-blue-800 text-white text-sm font-semibold rounded-lg cursor-pointer"
                >
                  {saving ? 'Menyimpan...' : 'Simpan Siswa'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Import Siswa dari Excel */}
      {importOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-3xl max-h-[92vh] overflow-y-auto p-6 space-y-5">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div className="flex items-center gap-2">
                <FileSpreadsheet className="w-5 h-5 text-emerald-700" />
                <h3 className="font-display text-lg font-bold text-slate-900">
                  Import Data Akun Siswa dari Excel (.xlsx)
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setImportOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 rounded-xl bg-blue-50/70 border border-blue-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="text-xs text-slate-700 space-y-1">
                <p className="font-bold text-slate-900">
                  Template Excel Akun Siswa (.xlsx)
                </p>
                <p>
                  Unduh template resmi, isi kolom Username/NIS, Nama Lengkap, Kelas, dan PIN Login, lalu unggah kembali di sini.
                </p>
              </div>
              <button
                type="button"
                onClick={() => downloadStudentExcelTemplate()}
                className="px-3.5 py-2 bg-white hover:bg-slate-50 border border-blue-300 text-blue-800 text-xs font-semibold rounded-lg flex items-center gap-1.5 shrink-0 cursor-pointer"
              >
                <Download className="w-4 h-4" />
                <span>Unduh Template (.xlsx)</span>
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-slate-50 border border-slate-200 rounded-xl p-3.5">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Pilih Kelas Tujuan (Opsional — untuk langsung menentukan kelas)
                </label>
                <select
                  value={importTargetClass}
                  onChange={(e) => handleImportTargetClassChange(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs bg-white"
                >
                  <option value="__from_file__">Gunakan kolom Kelas di file Excel</option>
                  {availableClasses.map((cls) => (
                    <option key={cls} value={cls}>
                      Semua masukkan ke Kelas {cls}
                    </option>
                  ))}
                  <option value="__custom__">+ Ketik Kelas Baru untuk Semua...</option>
                </select>
              </div>
              {importTargetClass === '__custom__' && (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Nama Kelas Baru
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={importCustomClass}
                      onChange={(e) => setImportCustomClass(e.target.value)}
                      placeholder="Contoh: VI B"
                      className="flex-1 px-3 py-2 rounded-lg border border-blue-300 text-xs bg-white"
                    />
                    {parsedRows.length > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          const clean = importCustomClass.trim();
                          if (clean) {
                            setParsedRows((prev) =>
                              prev.map((r) => ({ ...r, className: clean }))
                            );
                          }
                        }}
                        className="px-3 py-2 bg-blue-700 text-white text-xs font-semibold rounded-lg cursor-pointer"
                      >
                        Terapkan
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <label className="block border-2 border-dashed border-slate-300 hover:border-blue-600 bg-slate-50 hover:bg-blue-50/40 rounded-xl p-6 text-center cursor-pointer transition-colors">
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                  onChange={handleExcelUpload}
                  className="hidden"
                />
                <Upload className="w-7 h-7 text-blue-700 mx-auto mb-2" />
                <p className="text-sm font-semibold text-slate-900">
                  {parsingExcel
                    ? 'Membaca file Excel...'
                    : importFileName
                    ? `File dipilih: ${importFileName}`
                    : 'Klik untuk memilih file Excel (.xlsx / .xls / .csv)'}
                </p>
                <p className="text-xs text-slate-500 mt-1">
                  Kolom yang dibaca: Username / NIS, Nama Lengkap, Kelas, dan PIN Login.
                </p>
              </label>

              {parsedRows.length > 0 && (
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600 pt-1">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={skipExamples}
                      onChange={(e) => handleToggleSkipExamples(e.target.checked)}
                      className="w-4 h-4 text-blue-700"
                    />
                    <span>Lewati baris contoh berawalan &ldquo;contoh_&rdquo;</span>
                  </label>
                  <span>
                    Siap diimpor:{' '}
                    <strong className="text-blue-700 tabular-nums">
                      {
                        parsedRows.filter(
                          (r) =>
                            selectedImportIds.includes(r.tempId) &&
                            !r.validationError
                        ).length
                      }{' '}
                      siswa
                    </strong>
                  </span>
                </div>
              )}
            </div>

            {importError && (
              <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{importError}</span>
              </div>
            )}

            {parsedRows.length > 0 && (
              <div className="max-h-72 overflow-y-auto border border-slate-200 rounded-xl">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                      <th className="py-2.5 px-3 w-8"></th>
                      <th className="py-2.5 px-3">Username / NIS</th>
                      <th className="py-2.5 px-3">Nama Lengkap</th>
                      <th className="py-2.5 px-3">Kelas</th>
                      <th className="py-2.5 px-3">PIN</th>
                      <th className="py-2.5 px-3">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {visibleImportRows.length === 0 ? (
                      <tr>
                        <td
                          colSpan={6}
                          className="py-6 px-4 text-center text-slate-500"
                        >
                          Semua baris pada file ini merupakan baris contoh template.
                        </td>
                      </tr>
                    ) : (
                      visibleImportRows.map((row) => {
                        const checked = selectedImportIds.includes(row.tempId);
                        const hasErr = Boolean(row.validationError);
                        return (
                          <tr
                            key={row.tempId}
                            className={hasErr ? 'bg-red-50/50' : 'bg-white'}
                          >
                            <td className="py-2 px-3">
                              <button
                                type="button"
                                disabled={hasErr}
                                onClick={() =>
                                  setSelectedImportIds((prev) =>
                                    prev.includes(row.tempId)
                                      ? prev.filter((id) => id !== row.tempId)
                                      : [...prev, row.tempId]
                                  )
                                }
                                className="disabled:opacity-40 cursor-pointer"
                              >
                                {checked && !hasErr ? (
                                  <CheckSquare className="w-4 h-4 text-blue-700" />
                                ) : (
                                  <Square className="w-4 h-4 text-slate-400" />
                                )}
                              </button>
                            </td>
                            <td className="py-2 px-3 font-mono font-bold text-blue-700">
                              {row.username}
                            </td>
                            <td className="py-2 px-3 font-medium text-slate-900">
                              {row.name}
                            </td>
                            <td className="py-2 px-3 text-slate-700">
                              <select
                                value={row.className}
                                onChange={(e) =>
                                  updateImportedRowClass(row.tempId, e.target.value)
                                }
                                className="px-2 py-1 rounded border border-slate-300 bg-white text-xs font-medium text-slate-800"
                              >
                                {Array.from(
                                  new Set([
                                    ...availableClasses,
                                    ...(row.className ? [row.className] : []),
                                    'Umum',
                                  ])
                                )
                                  .sort((a, b) => a.localeCompare(b, 'id'))
                                  .map((cls) => (
                                    <option key={cls} value={cls}>
                                      {cls}
                                    </option>
                                  ))}
                              </select>
                            </td>
                            <td className="py-2 px-3 font-mono text-slate-700">
                              {row.pin}
                            </td>
                            <td className="py-2 px-3">
                              {row.validationError ? (
                                <span className="text-red-700 font-medium">
                                  {row.validationError}
                                </span>
                              ) : (
                                <span className="text-emerald-700 font-semibold">
                                  Valid
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            )}

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-200">
              <button
                type="button"
                onClick={() => setImportOpen(false)}
                className="px-4 py-2 border border-slate-300 text-slate-700 text-sm font-medium rounded-lg cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={
                  importingExcel ||
                  parsingExcel ||
                  parsedRows.filter(
                    (r) =>
                      selectedImportIds.includes(r.tempId) && !r.validationError
                  ).length === 0
                }
                onClick={handleConfirmExcelImport}
                className="px-5 py-2 bg-blue-700 hover:bg-blue-800 disabled:opacity-50 text-white text-sm font-semibold rounded-lg cursor-pointer"
              >
                {importingExcel
                  ? 'Mengimpor...'
                  : `Import ${
                      parsedRows.filter(
                        (r) =>
                          selectedImportIds.includes(r.tempId) &&
                          !r.validationError
                      ).length
                    } Siswa Terpilih`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Cetak Kartu Ujian Peserta */}
      {cardsOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-4xl max-h-[92vh] overflow-y-auto p-6 space-y-5">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div className="flex items-center gap-2">
                <Printer className="w-5 h-5 text-blue-700" />
                <h3 className="font-display text-lg font-bold text-slate-900">
                  Cetak Kartu Ujian Peserta ({cardsToPrint.length} Kartu)
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setCardsOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Nama Sekolah / Instansi
                </label>
                <input
                  type="text"
                  value={schoolName}
                  onChange={(e) => setSchoolName(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Judul Kartu Ujian
                </label>
                <input
                  type="text"
                  value={cardTitle}
                  onChange={(e) => setCardTitle(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Tahun Pelajaran / Keterangan
                </label>
                <input
                  type="text"
                  value={academicYear}
                  onChange={(e) => setAcademicYear(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Peserta yang Dicetak
                </label>
                <select
                  value={cardClassFilter}
                  onChange={(e) => setCardClassFilter(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs bg-white"
                >
                  {cardTargetIds && cardTargetIds.length > 0 && (
                    <option value="selected">
                      Siswa Terpilih ({cardTargetIds.length} siswa)
                    </option>
                  )}
                  <option value="all">Semua Kelas ({students.length} siswa)</option>
                  {availableClasses.map((cls) => (
                    <option key={cls} value={cls}>
                      Kelas {cls} ({classCounts.get(cls) || 0} siswa)
                    </option>
                  ))}
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Tautkan Info Ujian &amp; Kode Ujian (Opsional)
                </label>
                <select
                  value={selectedExamId}
                  onChange={(e) => setSelectedExamId(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs bg-white"
                >
                  <option value="">
                    Kartu Login Umum (Tanpa Kode Ujian Spesifik)
                  </option>
                  {exams.map((ex) => (
                    <option key={ex.id} value={String(ex.id)}>
                      {ex.examCode} — {ex.title}
                      {ex.targetClasses?.length
                        ? ` (${ex.targetClasses.join(', ')})`
                        : ' (Semua Kelas)'}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {cardsToPrint.length === 0 ? (
              <div className="p-8 rounded-xl border border-slate-200 bg-slate-50 text-center text-xs text-slate-600">
                Tidak ada peserta yang sesuai dengan filter kelas atau ujian terpilih.
              </div>
            ) : (
              <div className="max-h-96 overflow-y-auto border border-slate-200 rounded-xl p-4 bg-slate-100">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                  {cardsToPrint.map(renderExamCard)}
                </div>
              </div>
            )}

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-200">
              <button
                type="button"
                onClick={() => setCardsOpen(false)}
                className="px-4 py-2 border border-slate-300 text-slate-700 text-sm font-medium rounded-lg cursor-pointer"
              >
                Tutup
              </button>
              <button
                type="button"
                disabled={cardsToPrint.length === 0}
                onClick={handlePrintCards}
                className="px-5 py-2 bg-blue-700 hover:bg-blue-800 disabled:opacity-50 text-white text-sm font-semibold rounded-lg flex items-center gap-2 cursor-pointer"
              >
                <Printer className="w-4 h-4" />
                <span>Cetak / Simpan PDF ({cardsToPrint.length} Kartu)</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Multi-page A4 Print Portal (Only visible during print) */}
      {cardsOpen &&
        cardsToPrint.length > 0 &&
        createPortal(
          <div id="exam-cards-print-portal" className="hidden">
            <div className="grid grid-cols-2 gap-4">
              {cardsToPrint.map(renderExamCard)}
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
