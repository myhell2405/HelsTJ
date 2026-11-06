"use client";

import { FormEvent, useEffect, useState } from "react";
import { LogIn } from "lucide-react";

export default function LoginForm() {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    fetch("/api/session")
      .then(async (response) => {
        if (!response.ok) throw new Error(`Server menjawab ${response.status}.`);
        return response.json() as Promise<{ authenticated: boolean }>;
      })
      .then((session) => {
        if (active && session.authenticated) window.location.replace("/");
      })
      .catch((error: unknown) => {
        if (active) setMessage(error instanceof Error ? error.message : "Status login gagal diperiksa.");
      });
    return () => { active = false; };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: form.get("username"),
          password: form.get("password"),
        }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "Login gagal.");
      window.location.replace("/");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Tidak dapat masuk. Silakan coba lagi.");
      setBusy(false);
    }
  }

  return (
    <section className="login-card">
      <span className="eyebrow">RUANG ADMIN</span>
      <h1>Selamat datang kembali.</h1>
      <p>Masuk untuk mengelola daftar lowongan dan tracker HelsTJ.</p>
      <form onSubmit={(event) => void submit(event)}>
        <label className="form-field">Nama pengguna
          <input className="control" name="username" required maxLength={32} autoComplete="username" autoFocus />
        </label>
        <label className="form-field" style={{ marginTop: 14 }}>Kata sandi
          <input className="control" type="password" name="password" required maxLength={256} autoComplete="current-password" />
        </label>
        {message && <p className="notice" role="status">{message}</p>}
        <button className="button button-primary full-width" style={{ marginTop: 20 }} disabled={busy}>
          <LogIn size={15} />{busy ? "Memeriksa akun..." : "Masuk ke dashboard"}
        </button>
      </form>
      <p style={{ marginBottom: 0 }}>Daftar lowongan bisa dilihat tanpa login.</p>
    </section>
  );
}
