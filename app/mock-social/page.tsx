const POSTS = [
 {
 id: "verified-original",
 author: "Macedonia Public Desk",
 handle: "@mpd_live",
 time: "12 min ago",
 badge: "Verified original",
 badgeClass: "bg-transparent/40 backdrop-blur-xl border border-white/5 border-t-white/20 rounded-2xl text-white",
 videoSrc: "/mock-social/verified-original.mp4",
 caption:
 "Original field footage from tonight's press briefing. Registered through Veritas before publishing.",
 stats: ["18 replies", "74 reposts", "310 likes"],
 },
 {
 id: "unverified",
 author: "Street Updates",
 handle: "@streetupdates",
 time: "23 min ago",
 badge: "Unverified",
 badgeClass: "bg-transparent/40 backdrop-blur-xl border border-white/5 border-t-white/20 rounded-2xl text-slate-300",
 videoSrc: "/mock-social/unverified.mp4",
 caption:
 "People are saying this clip is from the same event, but no source record is attached yet.",
 stats: ["41 replies", "126 reposts", "580 likes"],
 },
 {
 id: "excerpt",
 author: "Regional Watch",
 handle: "@regionalwatch",
 time: "31 min ago",
 badge: "Excerpt of verified video",
 badgeClass: "bg-transparent/40 backdrop-blur-xl border border-white/5 border-t-white/20 rounded-2xl0/10 text-white",
 videoSrc: "/mock-social/verified-excerpt.mp4",
 caption:
 "Short excerpt circulating with a new caption. Veritas should identify whether this still matches the registered original.",
 stats: ["9 replies", "52 reposts", "201 likes"],
 },
];

export default function MockSocialPage() {
 return (
 <main className="min-h-screen bg-transparent/40 backdrop-blur-xl border border-white/5 border-t-white/20 rounded-2xl">
 <div className="mx-auto grid max-w-6xl gap-6 px-4 py-8 lg:grid-cols-[16rem_1fr_18rem]">
 <aside className="hidden lg:block">
 <div className="sticky top-6 space-y-2">
 {["Home", "Search", "Live", "Bookmarks", "Profile"].map((item) => (
 <div key={item} className="rounded-lg px-3 py-2 text-sm font-medium text-slate-300">
 {item}
 </div>
 ))}
 </div>
 </aside>

 <section className="space-y-4">
 <header className="rounded-lg border border-white/10 bg-transparent/40 backdrop-blur-xl border border-white/5 border-t-white/20 rounded-2xl/50 backdrop-blur-md p-4">
 <p className="text-xs font-semibold uppercase tracking-wide text-white">Veritas demo network</p>
 <h1 className="mt-1 text-2xl font-semibold text-white">Social video feed</h1>
 <p className="mt-2 text-sm leading-6 text-slate-300">
 Use the Firefox extension popup on this page to demonstrate how social videos are checked.
 </p>
 </header>

 {POSTS.map((post) => (
 <article key={post.id} className="rounded-lg border border-white/10 bg-transparent/40 backdrop-blur-xl border border-white/5 border-t-white/20 rounded-2xl/50 backdrop-blur-md">
 <div className="flex gap-3 p-4">
 <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-transparent/40 backdrop-blur-xl border border-white/5 border-t-white/20 rounded-2xl hover:bg-white/5 text-sm font-semibold text-white">
 {post.author
 .split(" ")
 .map((word) => word[0])
 .slice(0, 2)
 .join("")}
 </div>
 <div className="min-w-0 flex-1">
 <div className="flex flex-wrap items-center gap-2">
 <h2 className="text-sm font-semibold text-white">{post.author}</h2>
 <span className="text-sm text-slate-400">{post.handle}</span>
 <span className="text-sm text-slate-400">.</span>
 <span className="text-sm text-slate-400">{post.time}</span>
 <span className={`rounded-full px-2 py-1 text-xs font-medium ${post.badgeClass}`}>
 {post.badge}
 </span>
 </div>
 <p className="mt-2 text-sm leading-6 text-slate-800">{post.caption}</p>

 <div className="mt-3 overflow-hidden rounded-lg border border-white/10 bg-transparent/40 backdrop-blur-xl border border-white/5 border-t-white/20 rounded-2xl hover:bg-white/5">
 <video
 className="aspect-video w-full bg-transparent/40 backdrop-blur-xl border border-white/5 border-t-white/20 rounded-2xl hover:bg-white/5 object-cover"
 controls
 playsInline
 preload="metadata"
 src={post.videoSrc}
 />
 </div>

 <div className="mt-3 flex flex-wrap gap-5 text-xs text-slate-400">
 {post.stats.map((stat) => (
 <span key={stat}>{stat}</span>
 ))}
 </div>
 </div>
 </div>
 </article>
 ))}
 </section>

 <aside className="hidden lg:block">
 <div className="sticky top-6 rounded-lg border border-white/10 bg-transparent/40 backdrop-blur-xl border border-white/5 border-t-white/20 rounded-2xl/50 backdrop-blur-md p-4">
 <p className="text-sm font-semibold text-white">Demo cases</p>
 <div className="mt-3 space-y-3 text-xs leading-5 text-slate-300">
 <p>One post represents a registered original.</p>
 <p>One post represents an unverified upload.</p>
 <p>One post represents a social excerpt with a different caption.</p>
 </div>
 </div>
 </aside>
 </div>
 </main>
 );
}
