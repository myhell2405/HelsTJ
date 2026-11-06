# HelsTJ — Job Tracker

HelsTJ adalah situs pencari dan pelacak lowongan kerja milik Helmy Akrim, lulusan baru Sistem Informasi. Daftar berfokus pada peluang dari berbagai perusahaan di Jabodetabek dan dapat dilihat teman tanpa akun.

## Fitur

- Halaman publik dengan pencarian dan filter lowongan.
- Teman mengisi nama dan hubungan dengan Helmy sebelum mengirim rekomendasi. Kiriman masuk ke halaman Aktivitas admin dan baru tampil setelah dikonfirmasi.
- Dashboard admin dengan ringkasan lamaran, aktivitas, pengguna, dan perusahaan.
- Daftar perusahaan beserta lokasi dan akses ke lowongan terkait.
- Admin dapat menambah, mengedit, menghapus, mencari, dan memfilter lowongan. Nama posisi dan perusahaan yang sama tidak dapat ditambahkan dua kali.
- Admin dapat mengimpor lowongan dari `.xlsx` atau `.csv` melalui pratinjau dan konfirmasi, serta mengekspor seluruh tracker ke `.xlsx`.
- Admin dapat mengelola akun pengguna dan melihat riwayat aktivitas.
- Catatan tracker, status lamaran, dan data pembuat tidak disertakan pada respons daftar publik.

## Teknologi

- **Next.js 16 App Router** untuk membangun halaman dan mengekspor antarmuka statis.
- **React 19 dan TypeScript** untuk komponen interaktif dan model data bertipe.
- **CSS** untuk tata letak responsif dan tampilan aplikasi.
- **Cloudflare Workers** untuk API, autentikasi, validasi, serta aturan akses.
- **Cloudflare D1 (SQLite)** untuk akun, sesi, tracker bersama, aktivitas, antrean saran, dan pembatasan kiriman.
- **Wrangler** untuk pengembangan, migrasi, dan deploy ke Cloudflare.

## Pengembangan lokal

Persyaratan: Node.js 22 atau lebih baru dan npm.

1. Pasang dependency:
   ```powershell
   npm install
   ```
2. Buat `.dev.vars` lokal (jangan commit) dengan kredensial admin yang kuat:
   ```text
   ADMIN_USERNAME=hlmykrm
   ADMIN_PASSWORD=kata-sandi-kuat-minimal-12-karakter
   ```
3. Terapkan migrasi D1 lokal:
   ```powershell
   npx wrangler d1 migrations apply helmy-job-tracker --local
   ```
4. Jalankan aplikasi lokal:
   ```powershell
   npm run dev
   ```
   Perintah ini membangun aplikasi Next.js sebagai situs statis, lalu menjalankan Worker dan D1 lokal lewat Wrangler. Buka URL yang ditampilkan Wrangler.

`npm run next:dev` menjalankan Next.js untuk mengerjakan antarmuka saja; API Worker/D1 tidak berjalan pada mode tersebut.

## Deploy ke Cloudflare

1. Masuk ke akun Cloudflare:
   ```powershell
   npx wrangler login
   ```
2. Pastikan database D1 `helmy-job-tracker` tersedia dan `database_id` di `wrangler.toml` sesuai akunmu.
3. Terapkan migrasi, termasuk detail pengirim saran dan riwayat konfirmasi:
   ```powershell
   npm run cf:db:migrate
   ```
4. Atur kredensial bootstrap admin sebagai Worker secrets:
   ```powershell
   npx wrangler secret put ADMIN_USERNAME
   npx wrangler secret put ADMIN_PASSWORD
   ```
   Gunakan username 3–32 karakter dan kata sandi unik minimal 12 karakter (16+ disarankan). Jangan taruh secret di source code atau file konfigurasi.
5. Jika ingin mengimpor data tracker awal dari `data/jobs.json`, lakukan sebelum deploy:
   ```powershell
   npm run cf:db:import
   ```
   Import hanya mengisi tracker yang masih kosong; data D1 yang sudah ada tidak ditimpa.
6. Build antarmuka Next.js dan deploy Worker:
   ```powershell
   npm run cf:deploy
   ```

`wrangler.toml` mengatur aset statis hasil ekspor Next.js dari folder `out`. Admin bootstrap dibuat otomatis saat login pertama pada database yang belum memiliki admin. Setelah itu, akun tambahan dapat dibuat melalui dashboard. Gunakan HTTPS dan jangan menghapus database D1 karena berisi akun, sesi, serta data tracker.

## Catatan keamanan

- Halaman publik hanya menampilkan informasi lowongan yang diperlukan; status lamaran, catatan pribadi, dan identitas penambah tetap privat.
- Saran publik mencatat nama dan hubungan pengirim hanya untuk admin, divalidasi, dibatasi maksimal lima kiriman per alamat IP tiap 15 menit, dan perlu dikonfirmasi di halaman Aktivitas sebelum diterbitkan.
- Perubahan data tracker dan pengelolaan akun hanya dapat dilakukan melalui sesi admin yang aman.
- Kata sandi disimpan sebagai hash PBKDF2; cookie sesi HttpOnly, Secure, dan SameSite.
- Jangan publikasikan `.dev.vars`, password, token Cloudflare, atau cadangan data yang berisi informasi tracker pribadi.

## Perintah

- `npm run dev` — build dan jalankan aplikasi lengkap menggunakan Wrangler/D1 lokal.
- `npm run next:dev` — jalankan antarmuka Next.js saja.
- `npm run build` — build dan ekspor situs statis Next.js ke `out`.
- `npm test` — jalankan tes aplikasi.
- `npm run cf:db:migrate` — terapkan migrasi D1 remote.
- `npm run cf:db:import` — impor data awal tracker.
- `npm run cf:deploy` — build dan deploy ke Cloudflare Workers.
