import LoginForm from "./login-form";

export default function LoginPage() {
  return (
    <div className="shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Kembali ke HelsTJ">
          <span className="brand-mark">HelsTJ</span>
          <span>hels<em>tj</em></span>
        </a>
        <a className="button button-secondary" href="/">Kembali ke beranda</a>
      </header>
      <main className="login-wrap">
        <LoginForm />
      </main>
      <footer className="footer content">© {new Date().getFullYear()} Helmy Akrim · HelsTJ Job Tracker</footer>
    </div>
  );
}
