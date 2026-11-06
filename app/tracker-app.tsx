"use client";

import {
  ArrowDownRight,
  ArrowLeft,
  ArrowUpRight,
  BriefcaseBusiness,
  Building2,
  Check,
  ChevronRight,
  Clock3,
  Download,
  FilePlus2,
  Filter,
  LogIn,
  LogOut,
  ListTodo,
  MapPin,
  Search,
  Send,
  ShieldCheck,
  Trash2,
  Upload,
  Users,
  X,
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

type Job = {
  id: number;
  company: string;
  role: string;
  category: string;
  location: string;
  sector: string;
  employerType: string;
  status: string;
  deadline: string;
  source: string;
  sourceUrl: string;
  applicationUrl: string;
  note: string;
  createdAt: string;
  createdBy: string;
  appliedDate: string;
  updated: string;
};

type Account = { id: number; username: string; role: string; active: number; created_at: string };
type Activity = { id: number; actor_username: string; action: string; summary: string; created_at: string };
type Todo = { id: number; parent_id: number | null; title: string; completed: number };
type DailyNote = { note_date: string; note: string; updated_at: string };
type DailyNotesResponse = { todayDate: string; yesterdayDate: string; notes: DailyNote[] };
type Suggestion = {
  id: number;
  job_json: string;
  submitter_name: string;
  relationship: string;
  submitted_at: string;
};
type Session = { username: string; role: string } | null;
type Page = "dashboard" | "companies" | "jobs" | "users" | "activity" | "todos";

type Submitter = { name: string; relationship: string };
type ImportPreview = { jobs: Partial<Job>[]; totalRows: number; skippedRows: number; fileName: string };

const EMPTY_JOB: Omit<Job, "id"> = {
  company: "",
  role: "",
  category: "Lainnya",
  location: "Jabodetabek",
  sector: "",
  employerType: "",
  status: "to_apply",
  deadline: "",
  source: "",
  sourceUrl: "",
  applicationUrl: "",
  note: "",
  createdAt: "",
  createdBy: "",
  appliedDate: "",
  updated: "",
};

function normalizeJobName(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("id");
}

const STATUS_LABELS: Record<string, string> = {
  to_apply: "Belum dilamar",
  applied: "Sudah dilamar",
  in_process: "Sedang diproses",
  rejected: "Tidak lolos",
  verify: "Perlu verifikasi",
  watchlist: "Pantauan",
  closed: "Ditutup",
};

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof body.error === "string" ? body.error : `Permintaan gagal (${response.status}).`);
  }
  return body as T;
}

function Logo() {
  return (
    <a className="brand" href="/" aria-label="HelsTJ, halaman utama">
      <span className="brand-mark">HelsTJ</span>
      <span>hels<em>tj</em></span>
    </a>
  );
}

function safeExternalUrl(value: string): string {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}

function Topbar({
  session,
  page,
  pendingCount,
  onNavigate,
  onLogout,
}: {
  session: Session;
  page: Page;
  pendingCount: number;
  onNavigate: (page: Page) => void;
  onLogout: () => void;
}) {
  const adminLinks: { page: Page; label: string; icon: React.ReactNode }[] = [
    { page: "dashboard", label: "Dashboard", icon: <BriefcaseBusiness size={15} /> },
    { page: "companies", label: "Perusahaan", icon: <Building2 size={15} /> },
    { page: "jobs", label: "Lowongan", icon: <FilePlus2 size={15} /> },
    { page: "users", label: "Pengguna", icon: <Users size={15} /> },
    { page: "activity", label: "Aktivitas", icon: <Clock3 size={15} /> },
    { page: "todos", label: "To Do", icon: <ListTodo size={15} /> },
  ];
  return (
    <header className={`topbar ${session?.role === "admin" ? "topbar-admin" : ""}`}>
      <Logo />
      {session?.role === "admin" && (
        <nav className="admin-navbar" aria-label="Navigasi admin">
          {adminLinks.map((item) => (
            <button
              key={item.page}
              className={`admin-nav-link ${page === item.page ? "active" : ""}`}
              aria-current={page === item.page ? "page" : undefined}
              onClick={() => onNavigate(item.page)}
            >
              {item.icon}{item.label}
              {item.page === "activity" && pendingCount > 0 && <span className="nav-count">{pendingCount}</span>}
            </button>
          ))}
        </nav>
      )}
      <div className="top-actions">
        {session ? (
          <>
            <span className="top-user">{session.username} · {session.role === "admin" ? "Admin" : "Pengguna"}</span>
            <button className="icon-button" onClick={onLogout} aria-label="Keluar" title="Keluar">
              <LogOut size={17} />
            </button>
          </>
        ) : (
          <a className="icon-button" href="/login/" aria-label="Login admin" title="Login">
            <LogIn size={17} />
          </a>
        )}
      </div>
    </header>
  );
}

function JobCard({ job }: { job: Job }) {
  const category = job.category.trim();
  const jobUrl = safeExternalUrl(job.applicationUrl) || safeExternalUrl(job.sourceUrl);

  return (
    <article className="job-card">
      <div className="job-card-top">
        <div className="company-mark" aria-hidden="true">
          {job.company.trim().slice(0, 2).toUpperCase()}
        </div>
        <div className="job-meta">
          <div className="job-company">{job.company}</div>
          <strong className="job-title">{job.role}</strong>
        </div>
        {category && category.toLocaleLowerCase("id") !== "lainnya" && (
          <span className="job-category">{category}</span>
        )}
      </div>
      <div className="job-info">
        <span><MapPin size={14} />{job.location || "Jabodetabek"}</span>
        {job.deadline && <span><Clock3 size={14} />{job.deadline}</span>}
        {job.source && <span><BriefcaseBusiness size={14} />{job.source}</span>}
      </div>
      {jobUrl && (
        <a className="job-url" href={jobUrl} target="_blank" rel="noopener noreferrer" title={jobUrl}>
          <span>{jobUrl}</span><ArrowUpRight size={14} />
        </a>
      )}
    </article>
  );
}

function JobFields({
  initial,
  submitLabel,
  onSubmit,
}: {
  initial: Partial<Job>;
  submitLabel: string;
  onSubmit: (job: Omit<Job, "id">) => Promise<void>;
}) {
  const [values, setValues] = useState({ ...EMPTY_JOB, ...initial });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function change(field: keyof Omit<Job, "id">, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await onSubmit(values);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Lowongan gagal disimpan.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <div className="form-grid">
        <label className="form-field">Nama perusahaan
          <input className="control" required maxLength={200} value={values.company} onChange={(e) => change("company", e.target.value)} />
        </label>
        <label className="form-field">Posisi
          <input className="control" required maxLength={300} value={values.role} onChange={(e) => change("role", e.target.value)} />
        </label>
        <label className="form-field">Kategori
          <input className="control" maxLength={100} value={values.category} onChange={(e) => change("category", e.target.value)} />
        </label>
        <label className="form-field">Lokasi
          <input className="control" required maxLength={150} value={values.location} onChange={(e) => change("location", e.target.value)} />
        </label>
        <label className="form-field">Batas waktu
          <input className="control" maxLength={200} value={values.deadline} onChange={(e) => change("deadline", e.target.value)} />
        </label>
        <label className="form-field">Sumber lowongan
          <input className="control" maxLength={1000} value={values.source} onChange={(e) => change("source", e.target.value)} />
        </label>
        <label className="form-field span-two">Link sumber
          <input className="control" type="url" maxLength={2000} placeholder="https://" value={values.sourceUrl} onChange={(e) => change("sourceUrl", e.target.value)} />
        </label>
        <label className="form-field span-two">Link lamaran
          <input className="control" type="url" maxLength={2000} placeholder="https://" value={values.applicationUrl} onChange={(e) => change("applicationUrl", e.target.value)} />
        </label>
        <label className="form-field span-two">Catatan
          <textarea className="control" maxLength={5000} value={values.note} onChange={(e) => change("note", e.target.value)} />
        </label>
      </div>
      {error && <p className="notice" role="alert">{error}</p>}
      <div className="dialog-actions">
        <button className="button button-primary" disabled={busy}>
          {busy ? "Menyimpan..." : submitLabel}
        </button>
      </div>
    </form>
  );
}

function Modal({
  title,
  description,
  onClose,
  children,
}: {
  title: string;
  description?: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="dialog-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="dialog" role="dialog" aria-modal="true" aria-label={title}>
        <div className="dialog-heading">
          <div><h2>{title}</h2>{description && <p>{description}</p>}</div>
          <button className="icon-button" onClick={onClose} aria-label="Tutup"><X size={17} /></button>
        </div>
        {children}
      </section>
    </div>
  );
}

function SuggestionFlow({
  onSubmit,
}: {
  onSubmit: (job: Omit<Job, "id">, submitter: Submitter) => Promise<void>;
}) {
  const [step, setStep] = useState<"identity" | "job">("identity");
  const [submitter, setSubmitter] = useState<Submitter>({ name: "", relationship: "" });
  function continueToJob(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSubmitter({
      name: String(form.get("submitterName")).trim(),
      relationship: String(form.get("relationship")).trim(),
    });
    setStep("job");
  }

  return step === "identity" ? (
    <form onSubmit={continueToJob}>
      <div className="form-grid">
        <label className="form-field span-two">Nama kamu
          <input className="control" name="submitterName" required maxLength={100} autoComplete="name" />
        </label>
        <label className="form-field span-two">Hubungan kamu dengan Helmy
          <input className="control" name="relationship" required maxLength={150} placeholder="Contoh: teman kuliah, rekan kerja, atau kenalan" />
        </label>
      </div>
      <p className="privacy-note">Nama dan hubunganmu hanya terlihat oleh Helmy untuk meninjau kiriman.</p>
      <div className="dialog-actions">
        <button className="button button-primary">Lanjut ke detail lowongan <ChevronRight size={15} /></button>
      </div>
    </form>
  ) : (
    <>
      <div className="submitter-summary">
        <span>Dikirim oleh <strong>{submitter.name}</strong> · {submitter.relationship}</span>
        <button className="button button-quiet" type="button" onClick={() => setStep("identity")}>Ubah</button>
      </div>
      <JobFields
        initial={EMPTY_JOB}
        submitLabel="Kirim untuk konfirmasi"
        onSubmit={(job) => onSubmit(job, submitter)}
      />
    </>
  );
}

function PublicLanding({
  jobs,
  onSuggest,
}: {
  jobs: Job[];
  onSuggest: () => void;
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("Semua bidang");
  const categories = useMemo(
    () => [...new Set(jobs.map((job) => job.category).filter(Boolean))].sort(),
    [jobs],
  );
  const filtered = jobs.filter((job) => {
    const text = `${job.company} ${job.role} ${job.category} ${job.location}`.toLowerCase();
    return text.includes(query.toLowerCase()) && (category === "Semua bidang" || job.category === category);
  });

  return (
    <>
      <main className="content">
        <section className="hero">
          <div>
            <span className="eyebrow">PERSONAL JOB TRACKER · JABODETABEK</span>
            <h1>Langkah kecil menuju <span>karier berikutnya.</span></h1>
            <p className="hero-copy">
              Halo, saya <strong>Helmy Akrim</strong>, lulusan baru Sistem Informasi.
              Di sini saya mengumpulkan dan melacak lowongan kerja dari berbagai
              perusahaan di wilayah Jabodetabek—semoga bermanfaat untuk kamu juga.
            </p>
            <div className="hero-actions">
              <a className="button button-primary" href="#lowongan">Jelajahi lowongan <ArrowDownRight size={16} /></a>
              <button className="button button-secondary" onClick={onSuggest}><Send size={15} /> Kirim info lowongan</button>
            </div>
            <div className="hero-note">Diperbarui berkala · Dikurasi langsung oleh Helmy</div>
          </div>
          <aside className="profile-card">
            <div className="profile-orbit"><BriefcaseBusiness size={22} /></div>
            <div className="profile-initials">HA</div>
            <h2>Helmy Akrim</h2>
            <div className="profile-role">Fresh Graduate · Sistem Informasi</div>
            <div className="profile-tags"><span className="tag">Pencari kerja</span><span className="tag">Jabodetabek</span><span className="tag">Berbagi peluang</span></div>
            <div className="profile-divider" />
            <div className="profile-info"><span>Fokus pencarian</span><strong>Teknologi & bisnis</strong></div>
          </aside>
        </section>

        <section className="section" id="lowongan">
          <div className="section-heading">
            <div><span className="eyebrow">DAFTAR LOWONGAN</span><h2>Peluang yang sedang saya lacak</h2>
              <p>Temukan posisi menarik dari berbagai perusahaan di Jabodetabek.</p></div>
            <span className="job-count">{filtered.length} lowongan tersedia</span>
          </div>
          <div className="filters">
            <label className="searchbox"><Search size={16} /><input className="control" aria-label="Cari lowongan" placeholder="Cari posisi atau perusahaan..." value={query} onChange={(event) => setQuery(event.target.value)} /></label>
            <select className="control" aria-label="Filter bidang" value={category} onChange={(event) => setCategory(event.target.value)}>
              <option>Semua bidang</option>{categories.map((item) => <option key={item}>{item}</option>)}
            </select>
          </div>
          <div className="job-grid">
            {filtered.length ? filtered.map((job) => <JobCard key={job.id} job={job} />) : (
              <div className="empty-state">Belum ada lowongan yang cocok dengan pencarianmu.</div>
            )}
          </div>
          <div className="share-banner">
            <div><h3>Menemukan lowongan yang cocok untuk Helmy?</h3><p>Kirimkan informasinya. Helmy akan meninjaunya sebelum masuk ke daftar bersama.</p></div>
            <button className="button button-primary" onClick={onSuggest}>Bagikan lowongan <Send size={15} /></button>
          </div>
        </section>
        <footer className="footer">© {new Date().getFullYear()} Helmy Akrim · HelsTJ Job Tracker</footer>
      </main>
    </>
  );
}

function Stats({ jobs, users, companies, activityCount }: {
  jobs: Job[];
  users: number;
  companies: number;
  activityCount: number;
}) {
  const applied = jobs.filter((job) => ["applied", "in_process", "rejected"].includes(job.status)).length;
  const items = [
    { label: "Sudah dilamar", value: applied, caption: "Termasuk proses lanjutan", icon: <Check size={17} /> },
    { label: "Aktivitas", value: activityCount, caption: "Riwayat tracker", icon: <Clock3 size={17} /> },
    { label: "Pengguna", value: users, caption: "Akun terdaftar", icon: <Users size={17} /> },
    { label: "Perusahaan", value: companies, caption: "Di daftar tracker", icon: <Building2 size={17} /> },
  ];
  return <div className="stat-grid">{items.map((item) => (
    <article className="stat-card" key={item.label}>
      <div className="job-info"><span>{item.icon}{item.label}</span></div>
      <div className="stat-value">{item.value}</div><div className="stat-caption">{item.caption}</div>
    </article>
  ))}</div>;
}

function JobTable({
  jobs,
  onEdit,
  onDelete,
  onStatus,
}: {
  jobs: Job[];
  onEdit: (job: Job) => void;
  onDelete: (job: Job) => void;
  onStatus: (job: Job, status: string) => void;
}) {
  if (!jobs.length) return <div className="empty-state">Belum ada lowongan untuk ditampilkan.</div>;
  return (
    <div className="table-wrap"><table>
      <thead><tr><th>POSISI</th><th>PERUSAHAAN</th><th>LOKASI</th><th>STATUS</th><th>BATAS WAKTU</th><th>AKSI</th></tr></thead>
      <tbody>{jobs.map((job) => <tr key={job.id}>
        <td><div className="table-primary">{job.role}</div><div className="table-secondary">{job.category}</div></td>
        <td>{job.company}</td><td>{job.location || "Jabodetabek"}</td>
        <td><select className="control" aria-label={`Status ${job.role}`} value={job.status} onChange={(event) => onStatus(job, event.target.value)}>
          {Object.entries(STATUS_LABELS).map(([key, label]) => <option value={key} key={key}>{label}</option>)}
        </select></td>
        <td>{job.deadline || "—"}</td>
        <td><div className="row-actions">
          {job.applicationUrl && <a className="small-button" href={job.applicationUrl} target="_blank" rel="noreferrer">Link <ChevronRight size={12} /></a>}
          <button className="small-button" onClick={() => onEdit(job)} aria-label={`Edit ${job.role}`}>Edit</button>
          <button className="small-button" onClick={() => onDelete(job)} aria-label={`Hapus ${job.role}`}><Trash2 size={13} /></button>
        </div></td>
      </tr>)}</tbody>
    </table></div>
  );
}

export default function TrackerApp() {
  const [session, setSession] = useState<Session>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [users, setUsers] = useState<Account[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [todos, setTodos] = useState<Todo[]>([]);
  const [dailyNotes, setDailyNotes] = useState<DailyNotesResponse | null>(null);
  const [dailyNoteDraft, setDailyNoteDraft] = useState("");
  const [dailyNoteInitialized, setDailyNoteInitialized] = useState(false);
  const [dailyNoteBusy, setDailyNoteBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState<Page>("dashboard");
  const [selectedCompany, setSelectedCompany] = useState("");
  const [jobModal, setJobModal] = useState<Job | null | "new">(null);
  const [suggestModal, setSuggestModal] = useState(false);
  const [accountModal, setAccountModal] = useState(false);
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [jobCompanyFilter, setJobCompanyFilter] = useState("all");
  const [alert, setAlert] = useState("");
  const [todoTitle, setTodoTitle] = useState("");
  const [todoParentId, setTodoParentId] = useState("");

  function notify(message: string) {
    setAlert(message);
    window.setTimeout(() => setAlert(""), 3800);
  }

  async function refreshJobs() {
    const result = await api<{ jobs: Job[] }>("/api/jobs");
    setJobs(result.jobs.map((job) => ({ ...EMPTY_JOB, ...job, location: job.location || "Jabodetabek" })));
  }

  async function refreshAdminData() {
    const [userResult, activityResult, suggestionResult, todoResult, dailyNoteResult] = await Promise.all([
      api<{ users: Account[] }>("/api/users"),
      api<{ activities: Activity[] }>("/api/activity"),
      api<{ suggestions: Suggestion[] }>("/api/suggestions"),
      api<{ todos: Todo[] }>("/api/todos"),
      api<DailyNotesResponse>("/api/daily-notes"),
    ]);
    setUsers(userResult.users);
    setActivities(activityResult.activities);
    setSuggestions(suggestionResult.suggestions);
    setTodos(todoResult.todos);
    setDailyNotes(dailyNoteResult);
    if (!dailyNoteInitialized) {
      setDailyNoteDraft(dailyNoteResult.notes.find((note) => note.note_date === dailyNoteResult.todayDate)?.note ?? "");
      setDailyNoteInitialized(true);
    }
  }

  useEffect(() => {
    let active = true;
    async function initialize() {
      try {
        const [jobsResult, sessionResult] = await Promise.all([
          api<{ jobs: Job[] }>("/api/jobs"),
          api<{ authenticated: boolean }>("/api/session"),
        ]);
        if (!active) return;
        setJobs(jobsResult.jobs.map((job) => ({ ...EMPTY_JOB, ...job, location: job.location || "Jabodetabek" })));
        if (sessionResult.authenticated) {
          const config = await api<{ currentUser: Session }>("/api/config");
          if (!active) return;
          setSession(config.currentUser);
          if (config.currentUser?.role === "admin") await refreshAdminData();
        }
      } catch (error) {
        if (active) notify(error instanceof Error ? error.message : "Aplikasi gagal dimuat.");
      } finally {
        if (active) setLoading(false);
      }
    }
    void initialize();
    return () => { active = false; };
  }, []);

  const companies = useMemo(() => {
    const grouped = new Map<string, { name: string; location: string; count: number }>();
    for (const job of jobs) {
      const current = grouped.get(job.company.toLocaleLowerCase());
      if (current) current.count += 1;
      else grouped.set(job.company.toLocaleLowerCase(), {
        name: job.company,
        location: job.location || "Jabodetabek",
        count: 1,
      });
    }
    return [...grouped.values()].sort((a, b) => a.name.localeCompare(b.name, "id"));
  }, [jobs]);

  const filteredAdminJobs = jobs.filter((job) => {
    const search = `${job.company} ${job.role} ${job.category} ${job.location}`.toLowerCase();
    return search.includes(query.toLowerCase())
      && (statusFilter === "all" || job.status === statusFilter)
      && (jobCompanyFilter === "all" || job.company.toLowerCase() === jobCompanyFilter);
  });

  async function logout() {
    try {
      await api("/api/logout", { method: "POST" });
      setSession(null);
      setPage("dashboard");
      notify("Kamu sudah keluar dari dashboard admin.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Gagal keluar.");
    }
  }

  async function saveJobs(nextJobs: Job[]) {
    await api("/api/jobs", { method: "PUT", body: JSON.stringify({ jobs: nextJobs }) });
    await refreshJobs();
    await refreshAdminData();
  }

  async function exportJobs() {
    try {
      const response = await fetch("/api/export/xlsx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobs }),
      });
      if (!response.ok) {
        const failure = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(failure.error || `Ekspor gagal (${response.status}).`);
      }
      const blob = await response.blob();
      const downloadUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = "helmy-job-tracker.xlsx";
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
      notify("File Excel berhasil diekspor.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Ekspor Excel gagal.");
    }
  }

  async function parseImportFile(file: File) {
    setImportBusy(true);
    try {
      const response = await fetch("/api/import/parse", {
        method: "POST",
        headers: {
          "Content-Type": "application/octet-stream",
          "X-File-Name": encodeURIComponent(file.name),
        },
        body: file,
      });
      const result = await response.json().catch(() => ({})) as {
        error?: string;
        jobs?: Partial<Job>[];
        totalRows?: number;
        skippedRows?: number;
      };
      if (!response.ok) throw new Error(result.error || `Impor gagal (${response.status}).`);
      if (!Array.isArray(result.jobs) || result.jobs.length === 0) {
        throw new Error("File tidak berisi lowongan valid yang bisa diimpor.");
      }
      if (jobs.length + result.jobs.length > 2000) {
        throw new Error("Jumlah lowongan akan melebihi batas 2.000 entri.");
      }
      setImportPreview({
        jobs: result.jobs,
        totalRows: result.totalRows ?? result.jobs.length,
        skippedRows: result.skippedRows ?? 0,
        fileName: file.name,
      });
    } catch (error) {
      notify(error instanceof Error ? error.message : "File gagal dibaca.");
    } finally {
      setImportBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function applyImport() {
    if (!importPreview) return;
    setImportBusy(true);
    const now = new Date();
    const date = now.toISOString().slice(0, 10);
    const startingId = Math.max(0, ...jobs.map((job) => job.id));
    const importedJobs: Job[] = importPreview.jobs.map((job, index) => ({
      ...EMPTY_JOB,
      ...job,
      id: startingId + index + 1,
      category: job.category?.trim() || "Lainnya",
      location: job.location?.trim() || "Jabodetabek",
      createdAt: job.createdAt || now.toISOString(),
      createdBy: session?.username || "",
      updated: date,
    }));
    try {
      await saveJobs([...jobs, ...importedJobs]);
      setImportPreview(null);
      notify(`${importedJobs.length} lowongan berhasil diimpor.`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Lowongan gagal diimpor.");
    } finally {
      setImportBusy(false);
    }
  }

  async function saveJob(draft: Omit<Job, "id">) {
    const editing = jobModal !== null && jobModal !== "new";
    const editedId = editing ? jobModal.id : null;
    const duplicate = jobs.some((job) => job.id !== editedId
      && normalizeJobName(job.company) === normalizeJobName(draft.company)
      && normalizeJobName(job.role) === normalizeJobName(draft.role));
    if (duplicate) {
      throw new Error(`Lowongan ${draft.role} di ${draft.company} sudah terdaftar. Periksa nama posisi dan perusahaan.`);
    }
    const editedJob: Job = {
      ...EMPTY_JOB,
      ...draft,
      id: editing ? jobModal.id : Math.max(0, ...jobs.map((job) => job.id)) + 1,
      createdAt: editing ? jobModal.createdAt : new Date().toISOString(),
      createdBy: editing ? jobModal.createdBy : session?.username || "",
      updated: new Date().toISOString().slice(0, 10),
    };
    const next = editing
      ? jobs.map((job) => job.id === editedJob.id ? editedJob : job)
      : [...jobs, editedJob];
    await saveJobs(next);
    setJobModal(null);
    notify(editing ? "Lowongan berhasil diperbarui." : "Lowongan berhasil ditambahkan.");
  }

  async function deleteJob(job: Job) {
    if (!window.confirm(`Hapus lowongan ${job.role} di ${job.company}?`)) return;
    try {
      await saveJobs(jobs.filter((item) => item.id !== job.id));
      notify("Lowongan berhasil dihapus.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Lowongan gagal dihapus.");
    }
  }

  async function updateStatus(job: Job, status: string) {
    try {
      await saveJobs(jobs.map((item) => item.id === job.id ? { ...item, status } : item));
      notify("Status lowongan diperbarui.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Status gagal diperbarui.");
    }
  }

  async function suggestJob(draft: Omit<Job, "id">, submitter: Submitter) {
    await api("/api/suggestions", {
      method: "POST",
      body: JSON.stringify({
        ...draft,
        submitterName: submitter.name,
        relationship: submitter.relationship,
      }),
    });
    setSuggestModal(false);
    notify("Terima kasih! Info lowongan sudah dikirim untuk ditinjau.");
  }

  async function decideSuggestion(id: number, decision: "approve" | "reject") {
    try {
      await api(`/api/suggestions/${id}`, { method: "PATCH", body: JSON.stringify({ decision }) });
      await Promise.all([refreshJobs(), refreshAdminData()]);
      notify(decision === "approve" ? "Lowongan diterbitkan." : "Saran ditolak.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Saran gagal diproses.");
    }
  }

  async function addAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await api("/api/users", {
        method: "POST",
        body: JSON.stringify({
          username: form.get("username"),
          password: form.get("password"),
        }),
      });
      setAccountModal(false);
      await refreshAdminData();
      notify("Akun pengguna berhasil dibuat.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Akun gagal dibuat.");
    }
  }

  async function removeAccount(user: Account) {
    if (!window.confirm(`Hapus akun ${user.username}?`)) return;
    try {
      await api(`/api/users/${user.id}`, { method: "DELETE" });
      await refreshAdminData();
      notify("Akun pengguna dihapus.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Akun gagal dihapus.");
    }
  }

  async function deleteActivity(activity: Activity) {
    if (!window.confirm(`Hapus aktivitas "${activity.summary}"?`)) return;
    try {
      await api(`/api/activity/${activity.id}`, { method: "DELETE" });
      await refreshAdminData();
      notify("Aktivitas berhasil dihapus.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Aktivitas gagal dihapus.");
    }
  }

  async function clearActivities() {
    if (!window.confirm("Kosongkan seluruh riwayat aktivitas? Tindakan ini tidak dapat dibatalkan.")) return;
    try {
      await api("/api/activity", { method: "DELETE" });
      await refreshAdminData();
      notify("Riwayat aktivitas berhasil dikosongkan.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Riwayat aktivitas gagal dikosongkan.");
    }
  }

  async function addTodo(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      await api("/api/todos", {
        method: "POST",
        body: JSON.stringify({
          title: todoTitle,
          parentId: todoParentId ? Number(todoParentId) : null,
        }),
      });
      setTodoTitle("");
      await refreshAdminData();
      notify("Tugas berhasil ditambahkan.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Tugas gagal ditambahkan.");
    }
  }

  async function toggleTodo(todo: Todo) {
    try {
      await api(`/api/todos/${todo.id}`, {
        method: "PATCH",
        body: JSON.stringify({ completed: !todo.completed }),
      });
      await refreshAdminData();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Status tugas gagal diperbarui.");
    }
  }

  async function deleteTodo(todo: Todo) {
    const hasChildren = todos.some((item) => item.parent_id === todo.id);
    if (!window.confirm(hasChildren
      ? `Hapus "${todo.title}" beserta semua subtugasnya?`
      : `Hapus tugas "${todo.title}"?`)) return;
    try {
      await api(`/api/todos/${todo.id}`, { method: "DELETE" });
      await refreshAdminData();
      notify("Tugas berhasil dihapus.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Tugas gagal dihapus.");
    }
  }

  const todoChildren = useMemo(() => {
    const children = new Map<number, Todo[]>();
    for (const todo of todos) {
      const parentId = todo.parent_id ?? 0;
      children.set(parentId, [...(children.get(parentId) ?? []), todo]);
    }
    return children;
  }, [todos]);
  const todoOptions = useMemo(() => {
    const options: { todo: Todo; depth: number }[] = [];
    function collect(parentId: number, depth: number) {
      for (const todo of todoChildren.get(parentId) ?? []) {
        options.push({ todo, depth });
        collect(todo.id, depth + 1);
      }
    }
    collect(0, 0);
    return options;
  }, [todoChildren]);
  const completedTodoCount = todos.filter((todo) => todo.completed).length;
  const todayNote = dailyNotes?.notes.find((note) => note.note_date === dailyNotes.todayDate);
  const yesterdayNote = dailyNotes?.notes.find((note) => note.note_date === dailyNotes.yesterdayDate);

  async function saveDailyNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setDailyNoteBusy(true);
    try {
      const result = await api<DailyNotesResponse>("/api/daily-notes", {
        method: "PUT",
        body: JSON.stringify({ note: dailyNoteDraft }),
      });
      setDailyNotes(result);
      setDailyNoteDraft(result.notes.find((note) => note.note_date === result.todayDate)?.note ?? "");
      setDailyNoteInitialized(true);
      notify("Catatan hari ini berhasil disimpan.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Catatan harian gagal disimpan.");
    } finally {
      setDailyNoteBusy(false);
    }
  }

  function formatNoteDate(date: string): string {
    return new Date(`${date}T12:00:00`).toLocaleDateString("id-ID", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  }

  function renderTodo(todo: Todo, depth = 0): React.ReactNode {
    return (
      <div className={`todo-task ${depth ? "todo-task-child" : ""}`} key={todo.id}>
        <div className="todo-task-row">
          <label className={`todo-task-label ${todo.completed ? "completed" : ""}`}>
            <input
              type="checkbox"
              checked={Boolean(todo.completed)}
              onChange={() => void toggleTodo(todo)}
              aria-label={`Tandai ${todo.title} ${todo.completed ? "belum selesai" : "selesai"}`}
            />
            <span>{todo.title}</span>
          </label>
          <button className="small-button todo-delete" onClick={() => void deleteTodo(todo)} aria-label={`Hapus ${todo.title}`}>
            <Trash2 size={13} />
          </button>
        </div>
        {(todoChildren.get(todo.id) ?? []).map((child) => renderTodo(child, depth + 1))}
      </div>
    );
  }

  function openCompany(name: string) {
    setSelectedCompany(name);
    setJobCompanyFilter(name.toLowerCase());
    setQuery("");
    setStatusFilter("all");
    setPage("jobs");
  }

  return (
    <div className="shell">
      <Topbar
        session={session}
        page={page}
        pendingCount={suggestions.length}
        onNavigate={(target) => {
          setPage(target);
          setSelectedCompany("");
          if (target === "jobs") setJobCompanyFilter("all");
        }}
        onLogout={() => void logout()}
      />
      {loading ? <main className="content loading">Memuat daftar lowongan...</main> : session?.role === "admin" ? (
        <main className="content admin-layout">
          <section className="admin-page">
            {page === "dashboard" && <>
              <div className="admin-title"><div><h1>Dashboard</h1><p>Ringkasan aktivitas HelsTJ hari ini.</p></div><span className="pill"><ShieldCheck size={13} /> Admin</span></div>
              <Stats jobs={jobs} users={users.length} companies={companies.length} activityCount={activities.length} />
              <div className="panel">
                <div className="panel-heading"><div><h2>Perusahaan dalam tracker</h2><p>Kelola perusahaan dan lowongan yang sedang dilacak.</p></div>
                  <button className="small-button" onClick={() => setPage("companies")}>Lihat semua <ChevronRight size={13} /></button>
                </div>
                <CompanyTable companies={companies.slice(0, 5)} onOpen={openCompany} />
              </div>
            </>}

            {page === "companies" && <>
              <div className="admin-title"><div><h1>Perusahaan</h1><p>Perusahaan dan lokasi lowongan di tracker kamu.</p></div></div>
              <div className="panel"><div className="panel-heading"><div><h2>Daftar perusahaan</h2><p>{companies.length} perusahaan terpantau</p></div></div>
                <CompanyTable companies={companies} onOpen={openCompany} />
              </div>
            </>}

            {page === "jobs" && <>
              <div className="admin-title"><div>{selectedCompany && <button className="button button-quiet" onClick={() => { setSelectedCompany(""); setJobCompanyFilter("all"); setPage("companies"); }}><ArrowLeft size={15} /> Kembali ke perusahaan</button>}
                <h1>{selectedCompany || "Daftar lowongan"}</h1><p>{selectedCompany ? "Lowongan yang dilacak dari perusahaan ini." : "Atur, cari, dan perbarui lowongan tracker."}</p></div>
                <div className="jobs-actions">
                  <input ref={fileInput} className="visually-hidden" type="file" accept=".xlsx,.csv" aria-label="Pilih file Excel atau CSV" onChange={(event) => {
                    const file = event.currentTarget.files?.[0];
                    if (file) void parseImportFile(file);
                  }} />
                  <button className="button button-secondary" disabled={importBusy} onClick={() => fileInput.current?.click()}><Upload size={15} /> {importBusy ? "Memproses..." : "Impor Excel"}</button>
                  <button className="button button-secondary" onClick={() => void exportJobs()}><Download size={15} /> Ekspor Excel</button>
                  <button className="button button-primary" onClick={() => setJobModal("new")}><FilePlus2 size={15} /> Tambah lowongan</button>
                </div></div>
              <div className="panel">
                <div className="admin-filter">
                  <label className="searchbox"><Search size={15} /><input className="control" placeholder="Cari lowongan..." value={query} onChange={(event) => setQuery(event.target.value)} /></label>
                  <select className="control" aria-label="Filter status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                    <option value="all">Semua status</option>{Object.entries(STATUS_LABELS).map(([key, value]) => <option key={key} value={key}>{value}</option>)}
                  </select>
                  <select className="control" aria-label="Filter perusahaan" value={jobCompanyFilter} onChange={(event) => setJobCompanyFilter(event.target.value)}>
                    <option value="all">Semua perusahaan</option>{companies.map((company) => <option key={company.name} value={company.name.toLowerCase()}>{company.name}</option>)}
                  </select>
                  <span className="job-count"><Filter size={13} /> {filteredAdminJobs.length} hasil</span>
                </div>
                <JobTable jobs={filteredAdminJobs} onEdit={(job) => setJobModal(job)} onDelete={(job) => void deleteJob(job)} onStatus={(job, status) => void updateStatus(job, status)} />
              </div>
            </>}

            {page === "users" && <>
              <div className="admin-title"><div><h1>Pengguna</h1><p>Kelola akses akun ke tracker bersama.</p></div><button className="button button-primary" onClick={() => setAccountModal(true)}><Users size={15} /> Tambah pengguna</button></div>
              <div className="panel"><div className="panel-heading"><div><h2>Akun terdaftar</h2><p>Pengguna dapat melihat tracker dan mengusulkan lowongan.</p></div></div>
                {users.length === 0 ? <div className="empty-state">Belum ada akun.</div> : <div className="table-wrap"><table><thead><tr><th>NAMA PENGGUNA</th><th>PERAN</th><th>STATUS</th><th>DIBUAT</th><th>AKSI</th></tr></thead>
                  <tbody>{users.map((user) => <tr key={user.id}><td className="table-primary">{user.username}</td><td>{user.role}</td><td><span className="pill">{user.active ? "Aktif" : "Nonaktif"}</span></td><td>{new Date(user.created_at).toLocaleDateString("id-ID")}</td><td>{user.role !== "admin" && <button className="small-button" onClick={() => void removeAccount(user)}><Trash2 size={13} /> Hapus</button>}</td></tr>)}</tbody>
                </table></div>}
              </div>
            </>}

            {page === "activity" && <>
              <div className="admin-title"><div><h1>Aktivitas</h1><p>Konfirmasi kiriman teman dan lihat perubahan tracker.</p></div>
                {suggestions.length > 0 && <span className="pill">{suggestions.length} menunggu konfirmasi</span>}</div>
              <div className="panel review-panel"><div className="panel-heading"><div><h2>Kiriman menunggu konfirmasi</h2><p>Lowongan baru hanya tampil di halaman depan setelah kamu konfirmasi.</p></div></div>
                {suggestions.length === 0 ? <div className="empty-state">Tidak ada kiriman yang menunggu konfirmasi.</div> : <div className="review-list">
                  {suggestions.map((item) => {
                    let suggested: Partial<Job> = {};
                    let valid = true;
                    try { suggested = JSON.parse(item.job_json) as Partial<Job>; } catch { valid = false; }
                    return <article className="review-card" key={item.id}>
                      <div className="review-heading"><div>
                        <span className="review-kicker">DIKIRIM OLEH</span>
                        <h3>{item.submitter_name || "Pengirim sebelumnya"}</h3>
                        <p>{item.relationship || "Hubungan belum dicatat"} · {new Date(item.submitted_at.replace(" ", "T") + "Z").toLocaleString("id-ID")}</p>
                      </div><span className="pill">Menunggu</span></div>
                      <div className="review-job">
                        <div className="review-company">{suggested.company || "Perusahaan tidak tersedia"}</div>
                        <strong>{suggested.role || (valid ? "Posisi tidak tersedia" : "Data tidak valid")}</strong>
                        <span>{suggested.location || "Jabodetabek"}{suggested.category ? ` · ${suggested.category}` : ""}{suggested.source ? ` · ${suggested.source}` : ""}</span>
                        {suggested.note && <p>{suggested.note}</p>}
                        {(suggested.sourceUrl || suggested.applicationUrl) && <div className="review-links">
                          {suggested.sourceUrl && <a href={suggested.sourceUrl} target="_blank" rel="noreferrer">Lihat sumber</a>}
                          {suggested.applicationUrl && <a href={suggested.applicationUrl} target="_blank" rel="noreferrer">Link lamaran</a>}
                        </div>}
                      </div>
                      <div className="review-actions">
                        <button className="button button-secondary" onClick={() => void decideSuggestion(item.id, "reject")}><X size={14} /> Tolak</button>
                        <button className="button button-primary" disabled={!valid} onClick={() => void decideSuggestion(item.id, "approve")}><Check size={14} /> Konfirmasi & tampilkan</button>
                      </div>
                    </article>;
                  })}
                </div>}
              </div>
              <div className="panel"><div className="panel-heading"><div><h2>Riwayat terbaru</h2><p>Aktivitas terakhir yang tercatat di sistem.</p></div>
                <button className="button button-danger" disabled={activities.length === 0} onClick={() => void clearActivities()}><Trash2 size={14} /> Kosongkan aktivitas</button>
              </div>
                {activities.length === 0 ? <div className="empty-state">Belum ada aktivitas tercatat.</div> : <div className="table-wrap"><table><thead><tr><th>AKTIVITAS</th><th>OLEH</th><th>WAKTU</th><th>AKSI</th></tr></thead>
                  <tbody>{activities.map((item) => <tr key={item.id}><td>{item.summary}</td><td>{item.actor_username}</td><td>{new Date(item.created_at.replace(" ", "T") + "Z").toLocaleString("id-ID")}</td><td><button className="small-button" aria-label={`Hapus aktivitas ${item.summary}`} onClick={() => void deleteActivity(item)}><Trash2 size={13} /> Hapus</button></td></tr>)}</tbody>
                </table></div>}
              </div>
            </>}

            {page === "todos" && <>
              <div className="admin-title">
                <div><h1>To Do List</h1><p>Atur tugas dan tandai progresmu satu per satu.</p></div>
                <span className="pill">{completedTodoCount} / {todos.length} selesai</span>
              </div>
                <div className="todo-columns">
                  <div className="panel todo-panel">
                    <div className="panel-heading"><div><h2>Daftar tugas</h2><p>Tugas dan subtugas hanya bisa dilihat serta dikelola oleh admin.</p></div></div>
                    <form className="todo-form" onSubmit={(event) => void addTodo(event)}>
                      <input
                        className="control"
                        aria-label="Nama tugas baru"
                        placeholder="Tulis tugas baru..."
                        maxLength={300}
                        required
                        value={todoTitle}
                        onChange={(event) => setTodoTitle(event.target.value)}
                      />
                      <select
                        className="control"
                        aria-label="Induk tugas"
                        value={todoParentId}
                        onChange={(event) => setTodoParentId(event.target.value)}
                      >
                        <option value="">Tugas utama</option>
                        {todoOptions.map(({ todo, depth }) => (
                          <option key={todo.id} value={todo.id}>
                            {"　".repeat(depth)}↳ {todo.title}
                          </option>
                        ))}
                      </select>
                      <button className="button button-primary"><ListTodo size={15} /> Tambah tugas</button>
                    </form>
                    <div className="todo-list">
                      {(todoChildren.get(0) ?? []).length
                        ? (todoChildren.get(0) ?? []).map((todo) => renderTodo(todo))
                        : <div className="empty-state">Belum ada tugas. Tambahkan tugas pertamamu di atas.</div>}
                    </div>
                  </div>
                  <section className="panel daily-note-panel">
                    <div className="panel-heading">
                      <div><h2>Catatan harian</h2><p>Tulis progres atau hal yang ingin dilanjutkan besok.</p></div>
                    </div>
                    {dailyNotes && <form className="daily-note-form" onSubmit={(event) => void saveDailyNote(event)}>
                      <label className="daily-note-today" htmlFor="daily-note-input">
                        Hari ini · {formatNoteDate(dailyNotes.todayDate)}
                      </label>
                      <textarea
                        id="daily-note-input"
                        className="control daily-note-input"
                        maxLength={10000}
                        placeholder="Apa yang sudah dikerjakan? Apa yang perlu dilanjutkan besok?"
                        value={dailyNoteDraft}
                        onChange={(event) => setDailyNoteDraft(event.target.value)}
                      />
                      <button className="button button-primary" disabled={dailyNoteBusy}>
                        {dailyNoteBusy ? "Menyimpan..." : todayNote ? "Perbarui catatan" : "Simpan catatan"}
                      </button>
                    </form>}
                    <div className="daily-note-history">
                      <h3>Kemarin</h3>
                      <span className="daily-note-date">{dailyNotes ? formatNoteDate(dailyNotes.yesterdayDate) : ""}</span>
                      {yesterdayNote?.note
                        ? <p className="daily-note-previous">{yesterdayNote.note}</p>
                        : <p className="daily-note-empty">Belum ada catatan untuk kemarin.</p>}
                    </div>
                    <p className="daily-note-retention">Catatan hari ini dan kemarin disimpan. Catatan yang lebih lama akan dihapus otomatis.</p>
                  </section>
                </div>
            </>}
          </section>
        </main>
      ) : (
        <PublicLanding jobs={jobs} onSuggest={() => setSuggestModal(true)} />
      )}

      {jobModal !== null && session?.role === "admin" && <Modal title={jobModal === "new" ? "Tambah lowongan" : "Edit lowongan"} description="Detail lowongan akan tersimpan di tracker bersama." onClose={() => setJobModal(null)}>
        <JobFields initial={jobModal === "new" ? EMPTY_JOB : jobModal} submitLabel={jobModal === "new" ? "Tambah lowongan" : "Simpan perubahan"} onSubmit={saveJob} />
      </Modal>}
      {importPreview && <Modal title="Pratinjau impor lowongan" description={`File: ${importPreview.fileName}. Data lama tetap dipertahankan; lowongan dari file akan ditambahkan.`} onClose={() => !importBusy && setImportPreview(null)}>
        <div className="import-summary">
          <span><strong>{importPreview.jobs.length}</strong> lowongan siap ditambahkan</span>
          <span>{importPreview.totalRows} baris dibaca · {importPreview.skippedRows} baris dilewati</span>
        </div>
        <div className="table-wrap import-preview-table"><table>
          <thead><tr><th>PERUSAHAAN</th><th>POSISI</th><th>LOKASI</th><th>STATUS</th></tr></thead>
          <tbody>{importPreview.jobs.slice(0, 5).map((job, index) => <tr key={`${job.company}-${job.role}-${index}`}>
            <td className="table-primary">{job.company}</td><td>{job.role}</td><td>{job.location || "Jabodetabek"}</td><td>{STATUS_LABELS[job.status || "to_apply"] || "Belum dilamar"}</td>
          </tr>)}</tbody>
        </table></div>
        {importPreview.jobs.length > 5 && <p className="table-secondary">Menampilkan 5 dari {importPreview.jobs.length} lowongan.</p>}
        <div className="dialog-actions">
          <button className="button button-secondary" disabled={importBusy} onClick={() => setImportPreview(null)}>Batal</button>
          <button className="button button-primary" disabled={importBusy} onClick={() => void applyImport()}>{importBusy ? "Mengimpor..." : `Konfirmasi impor ${importPreview.jobs.length} lowongan`}</button>
        </div>
      </Modal>}
      {suggestModal && <Modal title="Bagikan lowongan" description="Kenalkan dirimu dahulu, lalu isi detail lowongan. Semua kiriman menunggu konfirmasi Helmy." onClose={() => setSuggestModal(false)}>
        <SuggestionFlow onSubmit={suggestJob} />
      </Modal>}
      {accountModal && <Modal title="Tambah pengguna" description="Kredensial awal dibagikan secara pribadi." onClose={() => setAccountModal(false)}>
        <form onSubmit={(event) => void addAccount(event)}>
          <div className="form-grid">
            <label className="form-field span-two">Nama pengguna<input className="control" name="username" required minLength={3} maxLength={32} pattern="[A-Za-z0-9._-]+" autoComplete="off" /></label>
            <label className="form-field span-two">Kata sandi awal<input className="control" type="password" name="password" required minLength={12} maxLength={256} autoComplete="new-password" /><span className="table-secondary">Minimal 12 karakter. Jangan gunakan kata sandi yang dipakai di layanan lain.</span></label>
          </div>
          <div className="dialog-actions"><button className="button button-primary">Buat akun</button></div>
        </form>
      </Modal>}
      {alert && <div className="alert" role="status">{alert}</div>}
    </div>
  );
}

function CompanyTable({
  companies,
  onOpen,
}: {
  companies: { name: string; location: string; count: number }[];
  onOpen: (company: string) => void;
}) {
  if (!companies.length) return <div className="empty-state">Perusahaan akan muncul setelah lowongan ditambahkan.</div>;
  return <div className="table-wrap"><table>
    <thead><tr><th>NO.</th><th>NAMA PERUSAHAAN</th><th>LOKASI</th><th>AKSI</th></tr></thead>
    <tbody>{companies.map((company, index) => <tr key={company.name}>
      <td>{String(index + 1).padStart(2, "0")}</td><td className="table-primary">{company.name}</td><td>{company.location}</td>
      <td><button className="small-button" onClick={() => onOpen(company.name)}>Lihat daftar lowongan <ChevronRight size={13} /></button></td>
    </tr>)}</tbody>
  </table></div>;
}
