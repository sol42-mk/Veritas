// app/layout.tsx
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Veritas - News Video Provenance",
  description: "Blockchain-backed video provenance for Macedonian news",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">
        <nav className="border-b border-gray-100 bg-white px-6 py-3 flex items-center gap-8">
          <a href="/" className="font-semibold text-gray-900 tracking-tight">
            Veritas
          </a>
          <a href="/register" className="text-sm text-gray-500 hover:text-gray-900 transition-colors">
            Register
          </a>
          <a href="/verify" className="text-sm text-gray-500 hover:text-gray-900 transition-colors">
            Verify
          </a>
        </nav>
        {children}
      </body>
    </html>
  );
}
