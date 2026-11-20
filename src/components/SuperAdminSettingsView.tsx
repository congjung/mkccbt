import { useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  Save,
  ShieldCheck,
  User,
} from 'lucide-react';
import { api } from '../lib/api';
import { AuthUser } from '../types/cbt';

interface SuperAdminSettingsViewProps {
  user: AuthUser;
  onUserUpdated: (updated: AuthUser) => void;
}

export function SuperAdminSettingsView({
  user,
  onUserUpdated,
}: SuperAdminSettingsViewProps) {
  const [name, setName] = useState(user.name || 'Super Admin MKC CBT');
  const [username, setUsername] = useState(user.username || 'webadmin');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    const cleanUsername = username.trim().toLowerCase();
    if (!/^[a-z0-9._-]{3,64}$/.test(cleanUsername)) {
      setError(
        'Username minimal 3 karakter dan hanya boleh huruf kecil, angka, titik (.), garis bawah (_), atau strip (-).'
      );
      return;
    }

    if (!currentPassword.trim()) {
      setError('Masukkan kata sandi saat ini untuk memverifikasi perubahan.');
      return;
    }

    const trimmedNew = newPassword.trim();
    if (trimmedNew) {
      if (trimmedNew.length < 6) {
        setError('Kata sandi baru minimal 6 karakter.');
        return;
      }
      if (trimmedNew !== confirmPassword.trim()) {
        setError('Konfirmasi kata sandi baru tidak cocok.');
        return;
      }
    } else if (confirmPassword.trim()) {
      setError('Isi kata sandi baru terlebih dahulu.');
      return;
    }

    setSaving(true);
    try {
      const res = await api.request<{
        user: AuthUser;
        passwordChanged: boolean;
      }>('/api/admin/super-admin-credentials', {
        method: 'PUT',
        body: JSON.stringify({
          name: name.trim(),
          username: cleanUsername,
          currentPassword,
          newPassword: trimmedNew,
        }),
      });

      onUserUpdated(res.user);
      setUsername(res.user.username);
      setName(res.user.name);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setSuccess(
        res.passwordChanged
          ? `Username (@${res.user.username}) dan kata sandi Super Admin berhasil disimpan. Gunakan kredensial baru saat login berikutnya.`
          : `Pengaturan Super Admin (@${res.user.username}) berhasil disimpan.`
      );
    } catch (err: any) {
      setError(
        err?.message || 'Gagal menyimpan pengaturan akun Super Admin.'
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 pb-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-50 border border-blue-200 text-blue-700 flex items-center justify-center shrink-0">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-display text-lg font-bold text-slate-900">
                Pengaturan Akun Super Admin
              </h2>
              <p className="text-sm text-slate-500 mt-0.5">
                Ubah nama tampilan, username login, dan kata sandi Super Admin agar lebih aman.
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-lg bg-slate-50 border border-slate-200 px-4 py-3 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="text-slate-600">
            Username aktif saat ini:{' '}
            <span className="font-mono font-bold text-slate-900">
              @{user.username}
            </span>
          </div>
          <span className="font-semibold text-blue-700">Role: Super Admin</span>
        </div>

        {error && (
          <div
            role="alert"
            className="p-3.5 rounded-lg bg-red-50 border border-red-200 text-red-800 text-sm flex items-start gap-2.5"
          >
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-600" />
            <span>{error}</span>
          </div>
        )}

        {success && (
          <div className="p-3.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm flex items-start gap-2.5">
            <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-600" />
            <span>{success}</span>
          </div>
        )}

        <form onSubmit={handleSave} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                Nama Tampilan Super Admin
              </label>
              <input
                type="text"
                required
                maxLength={100}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Contoh: Administrator Sekolah"
                className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 bg-white text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                Username Login Super Admin <span className="text-red-600">*</span>
              </label>
              <div className="relative">
                <User className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  required
                  minLength={3}
                  maxLength={64}
                  value={username}
                  onChange={(e) => setUsername(e.target.value.toLowerCase())}
                  placeholder="Contoh: adminsdn09"
                  className="w-full pl-9 pr-3.5 py-2.5 rounded-lg border border-slate-300 bg-white text-slate-900 text-sm font-mono lowercase focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600"
                />
              </div>
              <p className="text-xs text-slate-500 mt-1">
                Huruf kecil, angka, titik (.), garis bawah (_), atau strip (-).
              </p>
            </div>
          </div>

          <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/70 space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                Kata Sandi Saat Ini (Wajib untuk Konfirmasi){' '}
                <span className="text-red-600">*</span>
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type={showCurrentPassword ? 'text' : 'password'}
                  required
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="Masukkan kata sandi saat ini"
                  className="w-full pl-9 pr-10 py-2.5 rounded-lg border border-slate-300 bg-white text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600"
                />
                <button
                  type="button"
                  onClick={() => setShowCurrentPassword((prev) => !prev)}
                  aria-label={
                    showCurrentPassword
                      ? 'Sembunyikan sandi saat ini'
                      : 'Tampilkan sandi saat ini'
                  }
                  className="p-1 text-slate-400 hover:text-slate-700 absolute right-2.5 top-1/2 -translate-y-1/2 cursor-pointer"
                >
                  {showCurrentPassword ? (
                    <EyeOff className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  Kata Sandi Baru (Opsional)
                </label>
                <div className="relative">
                  <KeyRound className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type={showNewPassword ? 'text' : 'password'}
                    minLength={6}
                    autoComplete="new-password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Kosongkan jika tidak ganti sandi"
                    className="w-full pl-9 pr-10 py-2.5 rounded-lg border border-slate-300 bg-white text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewPassword((prev) => !prev)}
                    aria-label={
                      showNewPassword
                        ? 'Sembunyikan sandi baru'
                        : 'Tampilkan sandi baru'
                    }
                    className="p-1 text-slate-400 hover:text-slate-700 absolute right-2.5 top-1/2 -translate-y-1/2 cursor-pointer"
                  >
                    {showNewPassword ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                </div>
                <p className="text-xs text-slate-500 mt-1">
                  Minimal 6 karakter jika ingin mengganti kata sandi.
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  Konfirmasi Kata Sandi Baru
                </label>
                <div className="relative">
                  <KeyRound className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type={showConfirmPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Ulangi kata sandi baru"
                    className="w-full pl-9 pr-10 py-2.5 rounded-lg border border-slate-300 bg-white text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword((prev) => !prev)}
                    aria-label={
                      showConfirmPassword
                        ? 'Sembunyikan konfirmasi sandi'
                        : 'Tampilkan konfirmasi sandi'
                    }
                    className="p-1 text-slate-400 hover:text-slate-700 absolute right-2.5 top-1/2 -translate-y-1/2 cursor-pointer"
                  >
                    {showConfirmPassword ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="pt-2 flex items-center justify-end">
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2.5 bg-blue-700 hover:bg-blue-800 disabled:opacity-60 text-white text-sm font-semibold rounded-lg transition-colors inline-flex items-center gap-2 cursor-pointer whitespace-nowrap"
            >
              <Save className="w-4 h-4" />
              <span>{saving ? 'Menyimpan...' : 'Simpan Pengaturan'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
