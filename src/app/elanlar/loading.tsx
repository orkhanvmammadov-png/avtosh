import { CardSkeleton, Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="py-6" aria-busy="true" aria-live="polite">
      <Skeleton className="mb-6 h-8 w-64" />
      <div className="flex flex-col gap-6 lg:flex-row">
        <Skeleton className="hidden h-[520px] w-72 shrink-0 rounded-card lg:block" />
        <div className="grid flex-1 grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }, (_, i) => <CardSkeleton key={i} />)}
        </div>
      </div>
    </div>
  );
}
