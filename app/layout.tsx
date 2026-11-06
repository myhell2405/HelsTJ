import type { Metadata } from "next";
import "./style.css";

export const metadata: Metadata = {
  title: "HelsTJ — Job Tracker",
  description:
    "Lowongan kerja Jabodetabek pilihan Helmy Akrim, lulusan baru Sistem Informasi.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="id">
      <body>{children}</body>
    </html>
  );
}
