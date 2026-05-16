import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import ParticleNetwork from "@/components/ParticleNetwork";
import WalletButton from "@/components/WalletButton";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Veritas - News Video Provenance",
  description: "Blockchain-backed video provenance for Macedonian news",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${inter.className} antialiased bg-background min-h-screen flex flex-col relative overflow-x-hidden`}>
        
        {/* Animated Blockchain Network Background */}
        <div className="fixed inset-0 z-[-1] pointer-events-none overflow-hidden bg-[#05010d]">
          {/* Massive Purple Glow */}
          <div className="absolute bottom-[-20%] left-1/2 -translate-x-1/2 w-[1200px] h-[800px] bg-purple-600/30 blur-[180px] rounded-[100%]"></div>
          <div className="absolute top-[-10%] right-[-10%] w-[600px] h-[600px] bg-cyan-600/20 blur-[150px] rounded-[100%]"></div>
          
          {/* Animated Particles Canvas */}
          <ParticleNetwork />
        </div>

        {/* Clean Minimal Navbar */}
        <nav className="w-full z-50 flex items-center justify-between px-6 md:px-8 py-5 relative">
          <a href="/" className="font-bold text-2xl text-white tracking-tight hover:opacity-80 transition-opacity">
            Veritas
          </a>
          
          <div className="hidden md:flex items-center gap-6">
            <a href="/register" className="text-sm font-medium text-slate-300 hover:text-white transition-colors">
              Register
            </a>
            <a href="/verify" className="text-sm font-medium text-slate-300 hover:text-white transition-colors">
              Verify
            </a>
            <a href="/my-videos" className="text-sm font-medium text-slate-300 hover:text-white transition-colors">
              My Videos
            </a>
            <a href="/mock-social" className="text-sm font-medium text-slate-300 hover:text-white transition-colors">
              Social
            </a>
            <WalletButton />
          </div>

          {/* Mobile: just the wallet button */}
          <div className="md:hidden">
            <WalletButton />
          </div>
        </nav>
        
        {/* Main Content Area */}
        <div className="flex-1 w-full relative z-10 flex flex-col">
          {children}
        </div>

      </body>
    </html>
  );
}

