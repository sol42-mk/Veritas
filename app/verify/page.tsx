export default function VerifyPage() {
  return (
    <main className="min-h-screen bg-slate-50 px-4 py-12">
      <div className="mx-auto max-w-3xl space-y-6">
        <header className="space-y-2">
          <p className="text-sm font-medium uppercase tracking-wide text-blue-700">Verification</p>
          <h1 className="text-3xl font-semibold text-slate-950">Verify a news video</h1>
          <p className="max-w-2xl text-sm leading-6 text-slate-600">
            This page will extract a Veritas watermark from uploaded footage and compare it with
            the Solana devnet provenance record.
          </p>
        </header>

        <section className="rounded-lg border border-slate-200 bg-white p-6">
          <div className="flex items-start gap-4">
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-md bg-blue-50">
              <svg className="h-5 w-5 text-blue-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M9 12.75L11.25 15 15 9.75M12 3.75l7.5 3v5.25c0 4.35-3.06 7.98-7.5 8.25-4.44-.27-7.5-3.9-7.5-8.25V6.75l7.5-3z"
                />
              </svg>
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-950">Coming next in the MVP</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                Registration is the working path right now. The next implementation step is reading
                `veritas_id` from video metadata, fetching the matching on-chain record, and showing
                whether the source and hash match.
              </p>
              <a
                href="/register"
                className="mt-5 inline-flex rounded-md bg-blue-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-800"
              >
                Go to registration
              </a>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
