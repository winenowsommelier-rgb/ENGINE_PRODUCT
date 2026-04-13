export default function ExploreLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 overflow-hidden bg-[#0a0a1a]">
      {children}
    </div>
  );
}
