export default function Home() {
  const currentYear = new Date().getFullYear();

  return (
    <div className="relative min-h-screen flex flex-col justify-between items-center text-white px-6 py-10 selection:bg-white selection:text-black font-sans">
      {/* Background aesthetic touches */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.03)_0%,transparent_70%)] pointer-events-none" />

      {/* Main Content */}
      <main className="flex flex-col items-center justify-center text-center my-auto max-w-5xl px-4 z-10 py-16">
        <h1 className="font-sekuya text-5xl sm:text-7xl md:text-8xl lg:text-9xl font-extrabold tracking-tight text-white leading-none uppercase drop-shadow-sm select-none">
          Coming Soon
        </h1>

        <div className="w-24 h-[1px] bg-white/30 my-8 sm:my-10" />

        <p className="max-w-md text-sm sm:text-base text-zinc-400 font-light tracking-widest uppercase leading-relaxed">
          Something new is on the way.
        </p>
      </main>

      {/* Footer */}
      <footer className="w-full max-w-7xl flex items-center justify-center border-t border-white/10 pt-6 pb-2 text-xs tracking-widest text-zinc-400 uppercase z-10">
        <p>
          by isamkids {currentYear}
        </p>
      </footer>
    </div>
  );
}


