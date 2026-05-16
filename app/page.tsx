import { CheckCircle2, Shield, UploadCloud } from "lucide-react";

export default function HomePage() {
  return (
    <main className="flex-1 flex flex-col justify-center items-center relative pt-20">
      
      {/* Massive Typography Hero */}
      <div className="text-center space-y-6 max-w-4xl px-6 relative z-20">
        <h1 className="text-5xl sm:text-6xl md:text-[5rem] font-bold tracking-tight text-white leading-tight">
          Verifiable News Provenance
        </h1>
        <p className="text-lg text-slate-300 md:text-xl max-w-3xl mx-auto">
          Let our infrastructure do the heavy lifting. Hash your uploads, embed watermarks, 
          and register source-backed provenance records natively on Solana devnet.
        </p>
      </div>

      {/* Massive Glass Dashboard Preview */}
      <div className="w-full max-w-6xl mt-24 px-6 mb-24 relative z-20">
        <div className="panel w-full p-8 md:p-12 min-h-[400px] flex flex-col">
          <div className="flex items-center gap-4 mb-8 pb-6 border-b border-white/10">
            <h2 className="text-white font-semibold text-lg flex items-center gap-2">
              <UploadCloud className="w-5 h-5 text-purple-400" /> Dashboard Preview
            </h2>
          </div>
          
          <div className="grid md:grid-cols-3 gap-8 text-left">
            <div className="space-y-4">
              <h3 className="text-white font-medium text-lg">01. Register</h3>
              <p className="text-slate-400 text-sm leading-relaxed">Veritas hashes the upload, embeds a watermark, and writes a source-backed record to Solana devnet.</p>
            </div>
            <div className="space-y-4">
              <h3 className="text-white font-medium text-lg">02. Publish</h3>
              <p className="text-slate-400 text-sm leading-relaxed">The journalist downloads a watermarked copy that carries the lookup ID for future checks.</p>
            </div>
            <div className="space-y-4">
              <h3 className="text-white font-medium text-lg">03. Verify</h3>
              <p className="text-slate-400 text-sm leading-relaxed">A viewer checks the watermark against the on-chain record to definitively see who registered the video.</p>
            </div>
          </div>
        </div>
      </div>

    </main>
  );
}
