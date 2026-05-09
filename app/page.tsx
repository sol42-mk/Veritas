const STEPS = [
  {
    title: "Register original footage",
    body: "Hash the upload, embed a Veritas watermark, and write a source-backed record to Solana devnet.",
  },
  {
    title: "Publish with provenance",
    body: "The journalist downloads a watermarked copy that carries the lookup ID for future checks.",
  },
  {
    title: "Verify later",
    body: "A viewer checks the watermark against the on-chain record to see who registered the video.",
  },
];

export default function HomePage() {
  return (
    <main className="min-h-screen bg-slate-50">
      <section className="border-b border-slate-200 bg-white">
        <div className="mx-auto grid max-w-6xl gap-10 px-6 py-16 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
          <div className="space-y-6">
            <p className="text-sm font-medium uppercase tracking-wide text-blue-700">Hackathon MVP</p>
            <div className="space-y-4">
              <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-slate-950 md:text-5xl">
                Verifiable provenance for news video.
              </h1>
              <p className="max-w-2xl text-base leading-7 text-slate-600">
                Veritas helps newsrooms register original footage on Solana devnet so viewers can later
                check whether a video matches a trusted source record.
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row">
              <a
                href="/register"
                className="rounded-md bg-blue-700 px-5 py-3 text-center text-sm font-medium text-white transition-colors hover:bg-blue-800"
              >
                Register a video
              </a>
              <a
                href="/verify"
                className="rounded-md border border-slate-300 bg-white px-5 py-3 text-center text-sm font-medium text-slate-800 transition-colors hover:bg-slate-50"
              >
                Verify footage
              </a>
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-950 p-5 text-white shadow-sm">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-white">Live proof model</p>
                <p className="text-xs text-slate-400">Solana devnet</p>
              </div>
              <div className="rounded-full bg-emerald-400/10 px-3 py-1 text-xs font-medium text-emerald-300">
                MVP ready
              </div>
            </div>
            <div className="space-y-3">
              {[
                ["Source", "Assigned by wallet"],
                ["Video hash", "SHA-256"],
                ["Watermark", "veritas_id metadata"],
                ["Record", "Program-derived account"],
              ].map(([label, value]) => (
                <div key={label} className="flex items-center justify-between rounded-md bg-white/5 px-4 py-3">
                  <span className="text-xs text-slate-400">{label}</span>
                  <span className="text-sm font-medium text-slate-100">{value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-12">
        <div className="grid gap-4 md:grid-cols-3">
          {STEPS.map((step, index) => (
            <article key={step.title} className="rounded-lg border border-slate-200 bg-white p-5">
              <div className="mb-4 flex h-8 w-8 items-center justify-center rounded-md bg-blue-50 text-sm font-semibold text-blue-700">
                {index + 1}
              </div>
              <h2 className="text-base font-semibold text-slate-950">{step.title}</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">{step.body}</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
